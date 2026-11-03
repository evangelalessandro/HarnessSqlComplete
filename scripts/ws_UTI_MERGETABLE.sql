/* ============================================================================
   ws_UTI_MERGETABLE
   ----------------------------------------------------------------------------
   Genera lo script T-SQL di una MERGE per trasportare i dati di una tabella
   da un database a un altro (o tra due tabelle), con due modalita':

     @Modo = 'Nomi'   (default)
        la MERGE legge dalla tabella sorgente: serve che la sorgente sia
        raggiungibile da dove si esegue lo script (stesso server, o linked
        server). Utile per rilanciarla quando serve.

     @Modo = 'Valori'
        la MERGE ha i DATI SCRITTI DENTRO: si copia il testo stampato e lo si
        esegue su un'altra connessione (anche un altro server) senza avere la
        sorgente. E' il caso "mi copio il risultato e ho i dati".

   Cosa genera
     MERGE INTO <destinazione> AS dst
     USING (<tabella sorgente> | VALUES (...)) AS src
        ON dst.<chiave> = src.<chiave> [AND ...]
     WHEN MATCHED THEN UPDATE SET <tutte le colonne comuni>
     WHEN NOT MATCHED BY TARGET THEN INSERT (<colonne>) VALUES (src.<colonne>)
     ;

   Sicurezza
     - NON genera mai DELETE: le righe presenti nella destinazione e non nella
       sorgente restano intatte.
     - Lo script viene solo STAMPATO (PRINT) e restituito come result set: non
       viene eseguito. Va copiato, riletto e lanciato a mano
       (facoltativamente anche da @Script ... OUTPUT).

   Esclusioni automatiche
     - identity fuori dall'INSERT (con @IncludiIdentity = 1 viene trasferita,
       con SET IDENTITY_INSERT ON/OFF)
     - colonne calcolate e rowversion/timestamp: mai in INSERT/UPDATE
     - colonne presenti in una sola delle due tabelle: non trasferite, e
       segnalate in un commento in testa allo script
     - colonne criptate (Always Encrypted) e colonne generate: escluse

   Parametri
     @Sorgente, @Destinazione  'tabella', 'schema.tabella' o 'db.schema.tabella'
     @Chiave                   colonne di join, separate da virgola
                               ('ID' oppure 'CODICE, DATA')
                               Se NULL si usa la PRIMARY KEY della destinazione.
     @IncludiIdentity          1 = trasferisce anche la colonna identity
     @EscludiColonne           colonne da non toccare ('DATA_MOD, UTENTE_MOD')
     @Modo                     'Nomi' (default) oppure 'Valori'
     @RighePerBlocco           righe per ogni statement generato (default 50)
     @Debug                    1 = informazioni sui passaggi intermedi
     @Script                   OUTPUT: lo script generato

   Esempi
     -- script da eseguire sullo stesso server
     EXEC dbo.ws_UTI_MERGETABLE @Sorgente     = N'DB_OLD.dbo.CLIENTI',
                                @Destinazione = N'DB_NEW.dbo.CLIENTI';

     -- script autonomo con i dati dentro, da portare altrove
     EXEC dbo.ws_UTI_MERGETABLE @Sorgente     = N'DB_OLD.dbo.CLIENTI',
                                @Destinazione = N'[DB_NEW].[dbo].[CLIENTI]',
                                @Modo         = N'Valori';

     -- chiave composta e colonne di audit fuori
     EXEC dbo.ws_UTI_MERGETABLE @Sorgente     = N'dbo.DAT_ORDINI_RIGHE',
                                @Destinazione = N'[ARCHIVIO].[dbo].[DAT_ORDINI_RIGHE]',
                                @Chiave       = N'ORD_ORDINE, RIG_RIGA',
                                @EscludiColonne = N'DATA_MOD, UTENTE_MOD',
                                @Modo         = N'Valori';

   Limiti
     - La MERGE non e' supportata se la destinazione ha un trigger
       INSTEAD OF UPDATE: in quel caso va riscritta come UPDATE + INSERT.
     - In modalita' Valori i testi vengono scritti come N'...': i caratteri
       Unicode non rappresentabili nella code page del client possono uscire
       come '?'.
     - Il totale stampato e' limitato dal buffer dei messaggi di PRINT
       (qualche decina di migliaia di caratteri per batch): per tabelle molto
       grosse usare @MaxRighe o estrarre lo script da @Script.
   ============================================================================ */

SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE [dbo].[ws_UTI_MERGETABLE]
(
     @Sorgente        nvarchar(776)
    ,@Destinazione    nvarchar(776)
    ,@Chiave          nvarchar(4000) = NULL
    ,@IncludiIdentity bit            = 0
    ,@EscludiColonne  nvarchar(4000) = NULL
    ,@Modo            nvarchar(10)   = N'Nomi'
    ,@RighePerBlocco  int            = 50
    ,@MaxRighe        bigint         = NULL    -- solo modalita' Valori (NULL = tutte)
    ,@Debug           bit            = 0
    ,@Script          nvarchar(max)  = NULL OUTPUT
)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Msg nvarchar(4000);

    IF @Modo NOT IN (N'Nomi', N'Valori')
    BEGIN
        RAISERROR(N'ws_UTI_MERGETABLE: @Modo deve essere Nomi o Valori.', 16, 1);
        RETURN 1;
    END

    /* ==================================================================
       0. Nomi: 'tabella', 'schema.tabella', 'db.schema.tabella'
       ================================================================== */
    DECLARE @Parti table (ord int IDENTITY(1,1) PRIMARY KEY, nome nvarchar(776));
    DECLARE @Resto nvarchar(800), @Parte nvarchar(776), @Chiusa int;

    DECLARE @SrcDb sysname, @SrcSchema sysname, @SrcTab sysname, @SrcNome nvarchar(800);
    DECLARE @DstDb sysname, @DstSchema sysname, @DstTab sysname, @DstNome nvarchar(800);

    /* --- sorgente --- */
    SET @Resto  = NULLIF(LTRIM(RTRIM(@Sorgente)), N'');
    SET @SrcDb  = NULL;
    DELETE FROM @Parti;

    WHILE @Resto IS NOT NULL AND @Resto <> N''
    BEGIN
        SET @Resto = LTRIM(@Resto);
        IF LEFT(@Resto, 1) = N'['
        BEGIN
            SET @Chiusa = CHARINDEX(N']', @Resto);
            IF @Chiusa > 1
                SET @Parte = REPLACE(SUBSTRING(@Resto, 2, @Chiusa - 2), N']]', N']');
            ELSE
                SET @Parte = NULL;
            SET @Resto = CASE WHEN @Chiusa > 1 THEN LTRIM(SUBSTRING(@Resto, @Chiusa + 1, 800)) ELSE N'' END;
        END
        ELSE
        BEGIN
            SET @Chiusa = CHARINDEX(N'.', @Resto);
            IF @Chiusa > 0
            BEGIN
                SET @Parte = RTRIM(LEFT(@Resto, @Chiusa - 1));
                SET @Resto = LTRIM(SUBSTRING(@Resto, @Chiusa + 1, 800));
            END
            ELSE
            BEGIN
                SET @Parte = @Resto;
                SET @Resto = N'';
            END
        END
        IF LEFT(@Resto, 1) = N'.' SET @Resto = LTRIM(SUBSTRING(@Resto, 2, 800));
        INSERT INTO @Parti (nome) VALUES (NULLIF(@Parte, N''));
    END

    IF (SELECT COUNT(*) FROM @Parti) = 0
    BEGIN
        RAISERROR(N'ws_UTI_MERGETABLE: @Sorgente obbligatorio.', 16, 1);
        RETURN 1;
    END

    SELECT @SrcTab = nome FROM @Parti WHERE ord = (SELECT MAX(ord) FROM @Parti);
    SELECT @SrcSchema = nome FROM @Parti WHERE ord = (SELECT MAX(ord) - 1 FROM @Parti);
    IF (SELECT COUNT(*) FROM @Parti) >= 3
        SELECT @SrcDb = nome FROM @Parti WHERE ord = (SELECT MAX(ord) - 2 FROM @Parti);
    SET @SrcSchema = ISNULL(NULLIF(@SrcSchema, N''), N'dbo');

    /* --- destinazione --- */
    SET @Resto = NULLIF(LTRIM(RTRIM(@Destinazione)), N'');
    SET @DstDb = NULL;
    SET @DstSchema = NULL;
    DELETE FROM @Parti;

    WHILE @Resto IS NOT NULL AND @Resto <> N''
    BEGIN
        SET @Resto = LTRIM(@Resto);
        IF LEFT(@Resto, 1) = N'['
        BEGIN
            SET @Chiusa = CHARINDEX(N']', @Resto);
            IF @Chiusa > 1
                SET @Parte = REPLACE(SUBSTRING(@Resto, 2, @Chiusa - 2), N']]', N']');
            ELSE
                SET @Parte = NULL;
            SET @Resto = CASE WHEN @Chiusa > 1 THEN LTRIM(SUBSTRING(@Resto, @Chiusa + 1, 800)) ELSE N'' END;
        END
        ELSE
        BEGIN
            SET @Chiusa = CHARINDEX(N'.', @Resto);
            IF @Chiusa > 0
            BEGIN
                SET @Parte = RTRIM(LEFT(@Resto, @Chiusa - 1));
                SET @Resto = LTRIM(SUBSTRING(@Resto, @Chiusa + 1, 800));
            END
            ELSE
            BEGIN
                SET @Parte = @Resto;
                SET @Resto = N'';
            END
        END
        IF LEFT(@Resto, 1) = N'.' SET @Resto = LTRIM(SUBSTRING(@Resto, 2, 800));
        INSERT INTO @Parti (nome) VALUES (NULLIF(@Parte, N''));
    END

    IF (SELECT COUNT(*) FROM @Parti) = 0
    BEGIN
        RAISERROR(N'ws_UTI_MERGETABLE: @Destinazione obbligatorio.', 16, 1);
        RETURN 1;
    END

    SELECT @DstTab = nome FROM @Parti WHERE ord = (SELECT MAX(ord) FROM @Parti);
    SELECT @DstSchema = nome FROM @Parti WHERE ord = (SELECT MAX(ord) - 1 FROM @Parti);
    IF (SELECT COUNT(*) FROM @Parti) >= 3
        SELECT @DstDb = nome FROM @Parti WHERE ord = (SELECT MAX(ord) - 2 FROM @Parti);
    SET @DstSchema = ISNULL(NULLIF(@DstSchema, N''), N'dbo');

    IF @SrcTab IS NULL OR @DstTab IS NULL
       OR QUOTENAME(@SrcSchema) IS NULL OR QUOTENAME(@SrcTab) IS NULL
       OR QUOTENAME(@DstSchema) IS NULL OR QUOTENAME(@DstTab) IS NULL
       OR (@SrcDb IS NOT NULL AND QUOTENAME(@SrcDb) IS NULL)
       OR (@DstDb IS NOT NULL AND QUOTENAME(@DstDb) IS NULL)
    BEGIN
        RAISERROR(N'ws_UTI_MERGETABLE: nome database/schema/tabella non valido.', 16, 1);
        RETURN 1;
    END

    SET @SrcNome = CASE WHEN @SrcDb IS NULL THEN N'' ELSE QUOTENAME(@SrcDb) + N'.' END
                 + QUOTENAME(@SrcSchema) + N'.' + QUOTENAME(@SrcTab);
    SET @DstNome = CASE WHEN @DstDb IS NULL THEN N'' ELSE QUOTENAME(@DstDb) + N'.' END
                 + QUOTENAME(@DstSchema) + N'.' + QUOTENAME(@DstTab);

    IF OBJECT_ID(@SrcNome, N'U') IS NULL
    BEGIN
        SET @Msg = N'ws_UTI_MERGETABLE: la tabella sorgente ' + @SrcNome + N' non esiste.';
        RAISERROR(@Msg, 16, 1);
        RETURN 1;
    END

    IF OBJECT_ID(@DstNome, N'U') IS NULL
    BEGIN
        SET @Msg = N'ws_UTI_MERGETABLE: la tabella destinazione ' + @DstNome + N' non esiste.';
        RAISERROR(@Msg, 16, 1);
        RETURN 1;
    END

    /* viste di catalogo: sono PER DATABASE, quindi vanno prefissate col db */
    DECLARE @SrcPrefisso nvarchar(300) =
            CASE WHEN @SrcDb IS NULL THEN N'' ELSE QUOTENAME(@SrcDb) + N'.' END;
    DECLARE @DstPrefisso nvarchar(300) =
            CASE WHEN @DstDb IS NULL THEN N'' ELSE QUOTENAME(@DstDb) + N'.' END;
    DECLARE @SqlMeta nvarchar(max);

    /* ==================================================================
       1. Colonne delle due tabelle
       ================================================================== */
    IF OBJECT_ID(N'tempdb..#ColSrc') IS NOT NULL DROP TABLE #ColSrc;
    IF OBJECT_ID(N'tempdb..#ColDst') IS NOT NULL DROP TABLE #ColDst;
    IF OBJECT_ID(N'tempdb..#TipiBase') IS NOT NULL DROP TABLE #TipiBase;

    CREATE TABLE #ColSrc (nome sysname PRIMARY KEY, tipo nvarchar(200), tipobase sysname, ident bit);
    CREATE TABLE #ColDst (nome sysname PRIMARY KEY, tipo nvarchar(200), tipobase sysname, ident bit,
                          calcolata bit, has_default bit);
    CREATE TABLE #TipiBase (nome sysname PRIMARY KEY, tipobase sysname);

    SET @SqlMeta =
          N'INSERT INTO #ColSrc (nome, tipo, tipobase, ident)'
        + N' SELECT c.name,'
        + N'        t.name + CASE'
        + N'                   WHEN t.name IN (N''nvarchar'', N''nchar'', N''varchar'', N''char'', N''varbinary'', N''binary'')'
        + N'                        THEN N''('' + CASE WHEN c.max_length = -1 THEN N''MAX'''
        + N'                                         ELSE CONVERT(nvarchar(10), CASE WHEN t.name IN (N''nvarchar'', N''nchar'') THEN c.max_length / 2 ELSE c.max_length END)'
        + N'                                    END + N'')'''
        + N'                   WHEN t.name = N''xml'' THEN N''(max)'''
        + N'                   WHEN t.name IN (N''decimal'', N''numeric'')'
        + N'                        THEN N''('' + CONVERT(nvarchar(10), c.precision) + N'','' + CONVERT(nvarchar(10), c.scale) + N'')'''
        + N'                   ELSE N'''''
        + N'                END,'
        + N'        t.name, c.is_identity'
        + N'   FROM ' + @SrcPrefisso + N'sys.columns AS c'
        + N'   JOIN ' + @SrcPrefisso + N'sys.types   AS t ON t.user_type_id = c.user_type_id'
        + N'  WHERE c.object_id = OBJECT_ID(@nome)'
        + N'    AND c.is_hidden = 0'
        + N'    AND c.generated_always_type = 0'
        + N'    AND ISNULL(COLUMNPROPERTY(c.object_id, c.name, N''IsEncrypted''), 0) = 0'
        + N'    AND t.name <> N''timestamp'';';
    EXEC sys.sp_executesql @SqlMeta, N'@nome nvarchar(800)', @nome = @SrcNome;

    SET @SqlMeta =
          N'INSERT INTO #ColDst (nome, tipo, tipobase, ident, calcolata, has_default)'
        + N' SELECT c.name,'
        + N'        t.name + CASE'
        + N'                   WHEN t.name IN (N''nvarchar'', N''nchar'', N''varchar'', N''char'', N''varbinary'', N''binary'')'
        + N'                        THEN N''('' + CASE WHEN c.max_length = -1 THEN N''MAX'''
        + N'                                         ELSE CONVERT(nvarchar(10), CASE WHEN t.name IN (N''nvarchar'', N''nchar'') THEN c.max_length / 2 ELSE c.max_length END)'
        + N'                                    END + N'')'''
        + N'                   WHEN t.name = N''xml'' THEN N''(max)'''
        + N'                   WHEN t.name IN (N''decimal'', N''numeric'')'
        + N'                        THEN N''('' + CONVERT(nvarchar(10), c.precision) + N'','' + CONVERT(nvarchar(10), c.scale) + N'')'''
        + N'                   ELSE N'''''
        + N'                END,'
        + N'        t.name, c.is_identity, c.is_computed, c.default_object_id'
        + N'   FROM ' + @DstPrefisso + N'sys.columns AS c'
        + N'   JOIN ' + @DstPrefisso + N'sys.types   AS t ON t.user_type_id = c.user_type_id'
        + N'  WHERE c.object_id = OBJECT_ID(@nome)'
        + N'    AND c.is_hidden = 0'
        + N'    AND c.generated_always_type = 0'
        + N'    AND ISNULL(COLUMNPROPERTY(c.object_id, c.name, N''IsEncrypted''), 0) = 0'
        + N'    AND t.name <> N''timestamp'';';
    EXEC sys.sp_executesql @SqlMeta, N'@nome nvarchar(800)', @nome = @DstNome;

    INSERT INTO #TipiBase (nome, tipobase) SELECT nome, tipobase FROM #ColSrc;

    DECLARE @ColSrc table (nome sysname PRIMARY KEY, tipo nvarchar(200), tipobase sysname, ident bit);
    DECLARE @ColDst table (nome sysname PRIMARY KEY, tipo nvarchar(200), tipobase sysname, ident bit,
                           calcolata bit, has_default bit);
    INSERT INTO @ColSrc SELECT nome, tipo, tipobase, ident FROM #ColSrc;
    INSERT INTO @ColDst SELECT nome, tipo, tipobase, ident, calcolata, has_default FROM #ColDst;

    /* ==================================================================
       2. Colori da trasferire: presenti in ENTRAMBE le tabelle
       ================================================================== */
    DECLARE @Esclusi table (nome sysname PRIMARY KEY);
    INSERT INTO @Esclusi (nome)
    SELECT DISTINCT LTRIM(RTRIM(s.value))
      FROM STRING_SPLIT(ISNULL(@EscludiColonne, N''), N',') AS s
     WHERE LTRIM(RTRIM(s.value)) <> N'';

    DECLARE @Comuni table (nome sysname PRIMARY KEY);
    INSERT INTO @Comuni (nome)
    SELECT d.nome
      FROM @ColDst AS d
      JOIN @ColSrc AS s ON s.nome = d.nome
     WHERE ISNULL(d.calcolata, 0) = 0
       AND NOT EXISTS (SELECT 1 FROM @Esclusi AS e WHERE e.nome = d.nome);

    IF (SELECT COUNT(*) FROM @Comuni) = 0
    BEGIN
        RAISERROR(N'ws_UTI_MERGETABLE: nessuna colonna in comune tra le due tabelle.', 16, 1);
        RETURN 1;
    END

    /* ==================================================================
       3. Chiave di join: quella passata, altrimenti la PRIMARY KEY
       ================================================================== */
    DECLARE @Chiavi table (nome sysname PRIMARY KEY);
    DECLARE @ChiaviNome table (nome sysname PRIMARY KEY);

    IF NULLIF(LTRIM(RTRIM(@Chiave)), N'') IS NOT NULL
    BEGIN
        INSERT INTO @ChiaviNome (nome)
        SELECT DISTINCT LTRIM(RTRIM(s.value))
          FROM STRING_SPLIT(@Chiave, N',') AS s
         WHERE LTRIM(RTRIM(s.value)) <> N'';
    END
    ELSE
    BEGIN
        IF OBJECT_ID(N'tempdb..#ChiaviPk') IS NOT NULL DROP TABLE #ChiaviPk;
        CREATE TABLE #ChiaviPk (nome sysname PRIMARY KEY, ordine int);
        SET @SqlMeta =
              N'INSERT INTO #ChiaviPk (nome, ordine)'
            + N' SELECT c.name, ic.key_ordinal'
            + N'   FROM ' + @DstPrefisso + N'sys.indexes AS i'
            + N'   JOIN ' + @DstPrefisso + N'sys.index_columns AS ic'
            + N'     ON ic.object_id = i.object_id AND ic.index_id = i.index_id'
            + N'   JOIN ' + @DstPrefisso + N'sys.columns AS c'
            + N'     ON c.object_id = ic.object_id AND c.column_id = ic.column_id'
            + N'  WHERE i.object_id = OBJECT_ID(@nome)'
            + N'    AND i.is_primary_key = 1'
            + N'    AND ic.is_included_column = 0;';
        EXEC sys.sp_executesql @SqlMeta, N'@nome nvarchar(800)', @nome = @DstNome;
        INSERT INTO @ChiaviNome (nome) SELECT nome FROM #ChiaviPk;
        DROP TABLE #ChiaviPk;
    END

    INSERT INTO @Chiavi (nome)
    SELECT k.nome
      FROM @ChiaviNome AS k
      JOIN @Comuni AS c ON c.nome = k.nome;

    IF (SELECT COUNT(*) FROM @Chiavi) = 0
    BEGIN
        SET @Msg = N'ws_UTI_MERGETABLE: nessuna chiave valida. La destinazione ' + @DstNome
                 + N' non ha PRIMARY KEY (o le colonne indicate non sono comuni): usare @Chiave.';
        RAISERROR(@Msg, 16, 1);
        RETURN 1;
    END

    IF (SELECT COUNT(*) FROM @Chiavi) <> (SELECT COUNT(*) FROM @ChiaviNome)
    BEGIN
        SET @Msg = N'ws_UTI_MERGETABLE: una colonna di @Chiave non esiste in entrambe le tabelle.';
        RAISERROR(@Msg, 16, 1);
        RETURN 1;
    END

    /* ==================================================================
       4. Liste di colonne per UPDATE e INSERT
       ================================================================== */
    DECLARE @SetList nvarchar(max), @UpdCols nvarchar(max), @InsCol nvarchar(max), @InsVal nvarchar(max);
    DECLARE @OnList  nvarchar(max), @LitOrd  nvarchar(max);

    SELECT @SetList = STRING_AGG(N'dst.' + QUOTENAME(c.nome) + N' = src.' + QUOTENAME(c.nome),
                                 N',' + CHAR(13) + CHAR(10) + N'       ')
                      WITHIN GROUP (ORDER BY c.nome)
      FROM @Comuni AS c
      JOIN @ColSrc AS s ON s.nome = c.nome
     WHERE s.ident = 0
       AND NOT EXISTS (SELECT 1 FROM @Chiavi AS k WHERE k.nome = c.nome);

    SELECT @UpdCols = STRING_AGG(c.nome, N', ') WITHIN GROUP (ORDER BY c.nome)
      FROM @Comuni AS c
      JOIN @ColSrc AS s ON s.nome = c.nome
     WHERE s.ident = 0
       AND NOT EXISTS (SELECT 1 FROM @Chiavi AS k WHERE k.nome = c.nome);

    SELECT @InsCol = STRING_AGG(QUOTENAME(c.nome), N', ') WITHIN GROUP (ORDER BY c.nome),
           @InsVal = STRING_AGG(N'src.' + QUOTENAME(c.nome), N', ') WITHIN GROUP (ORDER BY c.nome)
      FROM @Comuni AS c
      JOIN @ColSrc AS s ON s.nome = c.nome
     WHERE s.ident = 0 OR @IncludiIdentity = 1;

    IF @InsCol IS NULL
    BEGIN
        RAISERROR(N'ws_UTI_MERGETABLE: nessuna colonna da inserire.', 16, 1);
        RETURN 1;
    END

    SELECT @OnList = STRING_AGG(N'dst.' + QUOTENAME(nome) + N' = src.' + QUOTENAME(nome),
                                CHAR(13) + CHAR(10) + N'    AND ')
                     WITHIN GROUP (ORDER BY nome)
      FROM @Chiavi;

    SELECT @LitOrd = STUFF((
        SELECT N', ' + QUOTENAME(nome)
          FROM @Chiavi
         ORDER BY nome
           FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N'');

    /* ==================================================================
       5. Intestazione, note, corpo della MERGE
       ================================================================== */
    DECLARE @Script2 nvarchar(max) = N'';
    DECLARE @Dati    nvarchar(max) = N'';
    DECLARE @Note    nvarchar(max) = N'';
    DECLARE @Elenco  nvarchar(max);

    SELECT @Elenco = STRING_AGG(QUOTENAME(d.nome), N', ')
      FROM @ColDst AS d
     WHERE NOT EXISTS (SELECT 1 FROM @ColSrc AS s WHERE s.nome = d.nome);
    IF @Elenco IS NOT NULL
        SET @Note = @Note + N'-- nella DESTINAZIONE ma non nella sorgente (non inserite): '
                  + @Elenco + CHAR(13) + CHAR(10);

    SET @Elenco = NULL;
    SELECT @Elenco = STRING_AGG(QUOTENAME(s.nome), N', ')
      FROM @ColSrc AS s
     WHERE NOT EXISTS (SELECT 1 FROM @ColDst AS d WHERE d.nome = s.nome);
    IF @Elenco IS NOT NULL
        SET @Note = @Note + N'-- nella SORGENTE ma non nella destinazione (non trasferite): '
                  + @Elenco + CHAR(13) + CHAR(10);

    /* --- 5a. in modalita' Valori si costruisce prima il blocco dati --- */
    IF @Modo = N'Valori'
    BEGIN
        DECLARE @Utili table (nome sysname PRIMARY KEY);
        INSERT INTO @Utili (nome)
        SELECT c.nome
          FROM @Comuni AS c
          JOIN @ColSrc AS s ON s.nome = c.nome
         WHERE s.ident = 0 OR @IncludiIdentity = 1;

        DECLARE @ColonneIns nvarchar(max), @ColonneVal nvarchar(max);
        SELECT @ColonneIns = STRING_AGG(QUOTENAME(nome), N', ') WITHIN GROUP (ORDER BY nome),
               @ColonneVal = STRING_AGG(N'src.' + QUOTENAME(nome), N', ') WITHIN GROUP (ORDER BY nome)
          FROM @Utili;

        /* espressione che produce il letterale di una colonna */
        DECLARE @SelectLit nvarchar(max) = N'', @Frammento nvarchar(2000);
        DECLARE @Cn sysname, @TipoBase sysname, @Prima bit = 1;

        DECLARE curCol CURSOR LOCAL FAST_FORWARD FOR
            SELECT u.nome FROM @Utili AS u ORDER BY u.nome;
        OPEN curCol;
        FETCH NEXT FROM curCol INTO @Cn;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            SET @TipoBase = (SELECT tipobase FROM @ColSrc WHERE nome = @Cn);

            SET @Frammento =
                  N'CASE WHEN src.' + QUOTENAME(@Cn) + N' IS NULL THEN N''NULL'' ELSE '
                + CASE
                    /* testo e guid: N'...' con gli apici raddoppiati */
                    WHEN @TipoBase IN (N'char', N'nchar', N'varchar', N'nvarchar', N'text', N'ntext',
                                       N'sysname', N'uniqueidentifier')
                        THEN N'CHAR(39) + REPLACE(CONVERT(nvarchar(max), src.' + QUOTENAME(@Cn)
                           + N'), CHAR(39), CHAR(39) + CHAR(39)) + CHAR(39)'
                    /* binari: 0xABCD */
                    WHEN @TipoBase IN (N'binary', N'varbinary', N'image')
                        THEN N'CHAR(48) + CHAR(120) + CONVERT(varchar(max), CONVERT(varbinary(max), src.' + QUOTENAME(@Cn) + N'), 2)'
                    WHEN @TipoBase = N'date'
                        THEN N'CHAR(39) + CONVERT(varchar(10), src.' + QUOTENAME(@Cn) + N', 23) + CHAR(39)'
                    WHEN @TipoBase = N'time'
                        THEN N'CHAR(39) + CONVERT(varchar(20), src.' + QUOTENAME(@Cn) + N', 114) + CHAR(39)'
                    WHEN @TipoBase = N'datetimeoffset'
                        THEN N'CHAR(39) + CONVERT(varchar(40), src.' + QUOTENAME(@Cn) + N', 127) + CHAR(39)'
                    WHEN @TipoBase IN (N'datetime', N'datetime2', N'smalldatetime')
                        THEN N'CHAR(39) + CONVERT(varchar(40), src.' + QUOTENAME(@Cn) + N', 126) + CHAR(39)'
                    /* numerici: nudi */
                    WHEN @TipoBase IN (N'int', N'bigint', N'smallint', N'tinyint', N'decimal', N'numeric',
                                       N'float', N'real', N'money', N'smallmoney')
                        THEN N'CONVERT(varchar(max), src.' + QUOTENAME(@Cn) + N')'
                    ELSE
                        N'CONVERT(varchar(max), src.' + QUOTENAME(@Cn) + N')'
                  END
                + N' END';

            IF @Prima = 0
                SET @SelectLit = @SelectLit + N' + N''' + ', ' + N''' + ';
            SET @SelectLit = @SelectLit + @Frammento;
            SET @Prima = 0;

            FETCH NEXT FROM curCol INTO @Cn;
        END
        CLOSE curCol;
        DEALLOCATE curCol;

        /* quante righe scrivere */
        DECLARE @TotVal bigint;
        DECLARE @MaxVal bigint = CASE WHEN ISNULL(@MaxRighe, 0) > 0
                                      THEN @MaxRighe
                                      ELSE CONVERT(bigint, 9223372036854775807) END;
        SET @SqlMeta = N'SELECT @tot = COUNT(*) FROM (SELECT TOP (@max) 1 AS x FROM ' + @SrcNome + N') AS q;';
        EXEC sys.sp_executesql @SqlMeta,
             N'@tot bigint OUTPUT, @max bigint',
             @tot = @TotVal OUTPUT, @max = @MaxVal;

        IF @RighePerBlocco IS NULL OR @RighePerBlocco <= 0 SET @RighePerBlocco = 50;

        /* stampa del blocco dati, a gruppi di righe (una query per gruppo) */
        DECLARE @SqlBlocco nvarchar(max) =
              N'SELECT @righe = STUFF(('
            + N'    SELECT CHAR(44) + CHAR(32) + CHAR(40) + ' + @SelectLit + N' + CHAR(41) AS [text()]'
            + N'      FROM ' + @SrcNome + N' AS src'
            + CASE WHEN @LitOrd IS NOT NULL THEN N' ORDER BY ' + @LitOrd ELSE N'' END
            + N'     OFFSET @off ROWS FETCH NEXT @n ROWS ONLY'
            + N'    FOR XML PATH(''''), TYPE).value(''.'', ''nvarchar(max)''), 1, 2, N'''');';

        DECLARE @Off bigint = 0, @Da bigint, @Corpo nvarchar(max);

        WHILE @Off < ISNULL(@TotVal, 0)
        BEGIN
            SET @Da = @RighePerBlocco;
            IF @Off + @Da > @TotVal SET @Da = @TotVal - @Off;

            SET @Corpo = NULL;
            EXEC sys.sp_executesql @SqlBlocco,
                 N'@righe nvarchar(max) OUTPUT, @off bigint, @n bigint',
                 @righe = @Corpo OUTPUT, @off = @Off, @n = @Da;

            IF @Corpo IS NULL SET @Corpo = N'';

            /* ogni blocco e' un INSERT ... VALUES a se': lo script resta
               eseguibile per parti */
            SET @Dati = @Dati
                      + N'INSERT INTO #Dati (' + @ColonneIns + N') VALUES' + CHAR(13) + CHAR(10)
                      + @Corpo + N';' + CHAR(13) + CHAR(10);

            IF @Debug = 1
            BEGIN
                SET @Msg = N'[ws_UTI_MERGETABLE] righe preparate: '
                         + CONVERT(nvarchar(20), @Off + @Da) + N' / ' + CONVERT(nvarchar(20), ISNULL(@TotVal, 0));
                PRINT @Msg;
            END

            SET @Off = @Off + @Da;
        END

        /* definizione delle colonne di #Dati: si usa il tipo della
           destinazione (cosi' l'INSERT nella tabella reale combacia sempre),
           con il tipo della sorgente come ripiego */
        DECLARE @Definizione nvarchar(max) = N'', @DefPrima bit = 1;
        DECLARE curDef CURSOR LOCAL FAST_FORWARD FOR
            SELECT u.nome FROM @Utili AS u ORDER BY u.nome;
        DECLARE @TipoDef nvarchar(200);
        OPEN curDef;
        FETCH NEXT FROM curDef INTO @Cn;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            SET @TipoDef = ISNULL((SELECT tipo FROM @ColDst WHERE nome = @Cn),
                                  (SELECT tipo FROM @ColSrc WHERE nome = @Cn));

            IF @DefPrima = 0 SET @Definizione = @Definizione + N',' + CHAR(13) + CHAR(10) + N'    ';
            SET @Definizione = @Definizione + QUOTENAME(@Cn) + N' ' + ISNULL(@TipoDef, N'nvarchar(max)');
            SET @DefPrima = 0;

            FETCH NEXT FROM curDef INTO @Cn;
        END
        CLOSE curDef;
        DEALLOCATE curDef;

        /* intestazione dello script autonomo */
        SET @Script2 =
              N'/* ===========================================================' + CHAR(13) + CHAR(10)
            + N'   MERGE con i dati DENTRO (modalita Valori)' + CHAR(13) + CHAR(10)
            + N'   sorgente     : ' + @SrcNome + CHAR(13) + CHAR(10)
            + N'   destinazione : ' + @DstNome + CHAR(13) + CHAR(10)
            + N'   righe        : ' + CONVERT(nvarchar(20), ISNULL(@TotVal, 0)) + CHAR(13) + CHAR(10)
            + N'   =========================================================== */' + CHAR(13) + CHAR(10)
            + N'-- Non dipende piu'' dalla sorgente: si puo'' eseguire su un''altra connessione.' + CHAR(13) + CHAR(10)
            + N'-- La tabella ' + @DstNome + N' deve esistere.' + CHAR(13) + CHAR(10)
            + N'-- Suggerimento: avvolgere in BEGIN TRAN / COMMIT TRAN.' + CHAR(13) + CHAR(10)
            + CHAR(13) + CHAR(10)
            + N'CREATE TABLE #Dati' + CHAR(13) + CHAR(10)
            + N'(' + CHAR(13) + CHAR(10)
            + N'    ' + @Definizione + CHAR(13) + CHAR(10)
            + N');' + CHAR(13) + CHAR(10)
            + CHAR(13) + CHAR(10)
            + @Dati
            + CHAR(13) + CHAR(10);

        IF @IncludiIdentity = 1
            SET @Script2 = @Script2
                + N'SET IDENTITY_INSERT ' + @DstNome + N' ON;' + CHAR(13) + CHAR(10)
                + N'GO' + CHAR(13) + CHAR(10);

        SET @Script2 = @Script2
            + N'MERGE INTO ' + @DstNome + N' AS dst' + CHAR(13) + CHAR(10)
            + N'USING (SELECT ' + @ColonneIns + N' FROM #Dati) AS src' + CHAR(13) + CHAR(10)
            + N'   ON ' + @OnList + CHAR(13) + CHAR(10);

        IF @UpdCols IS NOT NULL
            SET @Script2 = @Script2
                + N'/* se la destinazione ha un trigger INSTEAD OF UPDATE la MERGE non e'' supportata */' + CHAR(13) + CHAR(10)
                + N'WHEN MATCHED THEN' + CHAR(13) + CHAR(10)
                + N'    UPDATE SET ' + @SetList + CHAR(13) + CHAR(10);

        SET @Script2 = @Script2
            + N'WHEN NOT MATCHED BY TARGET THEN' + CHAR(13) + CHAR(10)
            + N'    INSERT (' + @ColonneIns + N')' + CHAR(13) + CHAR(10)
            + N'    VALUES (' + @ColonneVal + N')' + CHAR(13) + CHAR(10)
            + N';' + CHAR(13) + CHAR(10);

        IF @IncludiIdentity = 1
            SET @Script2 = @Script2
                + N'GO' + CHAR(13) + CHAR(10)
                + N'SET IDENTITY_INSERT ' + @DstNome + N' OFF;' + CHAR(13) + CHAR(10);

        SET @Script2 = @Script2
            + CHAR(13) + CHAR(10)
            + N'DROP TABLE #Dati;' + CHAR(13) + CHAR(10);
    END
    ELSE
    BEGIN
        /* --- 5b. modalita' Nomi: la MERGE legge dalla sorgente --- */
        SET @Script2 =
              N'/* ===========================================================' + CHAR(13) + CHAR(10)
            + N'   MERGE generata da dbo.ws_UTI_MERGETABLE' + CHAR(13) + CHAR(10)
            + N'   sorgente     : ' + @SrcNome + CHAR(13) + CHAR(10)
            + N'   destinazione : ' + @DstNome + CHAR(13) + CHAR(10)
            + N'   chiave       : ' + ISNULL((SELECT STRING_AGG(nome, N', ') FROM @Chiavi), N'') + CHAR(13) + CHAR(10)
            + N'   =========================================================== */' + CHAR(13) + CHAR(10)
            + N'-- La sorgente deve essere raggiungibile da dove si esegue lo script.' + CHAR(13) + CHAR(10)
            + N'-- Suggerimento: avvolgere in BEGIN TRAN / COMMIT TRAN.' + CHAR(13) + CHAR(10)
            + CHAR(13) + CHAR(10);

        IF @IncludiIdentity = 1
            SET @Script2 = @Script2
                + N'SET IDENTITY_INSERT ' + @DstNome + N' ON;' + CHAR(13) + CHAR(10)
                + N'GO' + CHAR(13) + CHAR(10);

        SET @Script2 = @Script2
            + N'MERGE INTO ' + @DstNome + N' AS dst' + CHAR(13) + CHAR(10)
            + N'USING (SELECT ' + @InsCol + CHAR(13) + CHAR(10)
            + N'         FROM ' + @SrcNome + N') AS src' + CHAR(13) + CHAR(10)
            + N'   ON ' + @OnList + CHAR(13) + CHAR(10);

        IF @UpdCols IS NOT NULL
            SET @Script2 = @Script2
                + N'/* se la destinazione ha un trigger INSTEAD OF UPDATE la MERGE non e'' supportata */' + CHAR(13) + CHAR(10)
                + N'WHEN MATCHED THEN' + CHAR(13) + CHAR(10)
                + N'    UPDATE SET ' + @SetList + CHAR(13) + CHAR(10);

        SET @Script2 = @Script2
            + N'WHEN NOT MATCHED BY TARGET THEN' + CHAR(13) + CHAR(10)
            + N'    INSERT (' + @InsCol + N')' + CHAR(13) + CHAR(10)
            + N'    VALUES (' + @InsVal + N')' + CHAR(13) + CHAR(10)
            + N';' + CHAR(13) + CHAR(10);

        IF @IncludiIdentity = 1
            SET @Script2 = @Script2
                + N'GO' + CHAR(13) + CHAR(10)
                + N'SET IDENTITY_INSERT ' + @DstNome + N' OFF;' + CHAR(13) + CHAR(10);
    END

    IF @Note <> N''
        SET @Script2 = N'/*' + CHAR(13) + CHAR(10) + @Note + N'*/' + CHAR(13) + CHAR(10) + @Script2;

    IF OBJECT_ID(N'tempdb..#ColSrc') IS NOT NULL DROP TABLE #ColSrc;
    IF OBJECT_ID(N'tempdb..#ColDst') IS NOT NULL DROP TABLE #ColDst;
    IF OBJECT_ID(N'tempdb..#TipiBase') IS NOT NULL DROP TABLE #TipiBase;

    SET @Script = @Script2;

    /* ==================================================================
       6. Output: PRINT (da copiare) + result set con lo script
       ================================================================== */
    IF @Debug = 1
    BEGIN
        SET @Msg = N'[ws_UTI_MERGETABLE] modo=' + @Modo
                 + N', colonne comuni=' + CONVERT(nvarchar(10), (SELECT COUNT(*) FROM @Comuni))
                 + N', chiavi=' + CONVERT(nvarchar(10), (SELECT COUNT(*) FROM @Chiavi))
                 + N', caratteri script=' + CONVERT(nvarchar(20), LEN(@Script2));
        PRINT @Msg;
    END

    DECLARE @Pos int = 1;
    WHILE @Pos <= LEN(@Script2)
    BEGIN
        PRINT SUBSTRING(@Script2, @Pos, 4000);
        SET @Pos = @Pos + 4000;
    END

    SELECT @Script2 AS ScriptMerge;

    RETURN 0;
END
GO
