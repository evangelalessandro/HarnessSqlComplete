/* ============================================================================
   sp_PrintTable
   ----------------------------------------------------------------------------
   Data una tabella di input (@Tabella, con @Schema opzionale):
     1) legge dinamicamente TUTTE le colonne della tabella (nessuna struttura
        fissa da mantenere: se la tabella cambia, la store continua a
        funzionare)
     2) "mergea" tutte le righe e tutte le colonne in un'unica stringa di testo
        (una riga di testo per ogni riga della tabella, valori separati)
     3) manda tutto in output con PRINT, a blocchi da 4000 caratteri

   Nessun limite di 8000 byte
     Su SQL Server < 2022 STRING_AGG restituisce nvarchar(4000)/varchar(8000)
     e con molte righe fallisce:
        Msg 9829 ... exceeded the limit of 8000 bytes. Use LOB types ...
     Il cast a nvarchar(max) non basta: il separatore concatena TUTTE le righe
     in una sola aggregazione.
     Qui il testo viene quindi costruito per gruppi di righe (FOR XML PATH +
     OFFSET/FETCH) e accumulato in una variabile nvarchar(max), con PRINT dei
     blocchi man mano: funziona su SQL Server 2012+ e non tronca nulla.
     (STRING_AGG resta usato solo per elencare i NOMI delle colonne, dove il
     limite di 8000 byte non e' raggiungibile.)

   Requisiti: SQL Server 2012+
   Permessi  : SELECT sulle colonne lette.

   Parametri
     @Tabella           nome tabella, anche 'schema.tabella' o 'db.schema.tabella'
     @Schema            schema, se non lo si passa dentro @Tabella (default dbo)
     @Filtro            WHERE opzionale, SENZA la parola WHERE
                        (es. N'STARIO = ''W'' AND QTA > 0')
     @Ordine            ORDER BY opzionale, SENZA "ORDER BY"
                        (es. N'RIGA DESC'; default: ordine fisico)
     @SeparaColonne     separatore tra i valori della stessa riga (default ' | ')
     @SeparaRighe       separatore tra le righe (default CR+LF)
     @MostraIntestazione 1 = stampa prima i nomi delle colonne
     @MaxRighe          numero massimo di righe stampate (NULL/<=0 = tutte)
     @Debug             1 = stampa i passi intermedi (utile per capire cosa fa)
     @Righe             OUTPUT: quante righe sono state stampate

   Esempi
     EXEC dbo.sp_PrintTable @Tabella = N'dbo.DAT_CLASSI_MERC';
     EXEC dbo.sp_PrintTable @Tabella = N'MAG_BAIE', @MaxRighe = 10;
     EXEC dbo.sp_PrintTable @Tabella = N'dbo.DAT_ORDINI_RIGHE',
                           @Filtro = N'RIG_STARIORD = ''W''',
                           @Ordine = N'RIG_RIGA DESC';
     EXEC dbo.sp_PrintTable @Tabella = N'dbo.DAT_CLASSI_MERC',
                           @MostraIntestazione = 0,
                           @SeparaColonne = N' ; ',
                           @SeparaRighe   = N' || ';

   Note
     - PRINT aggiunge un a capo per ogni chiamata: il testo viene spezzato in
       blocchi da 4000 caratteri, quindi non si perde nulla.
     - Il limite vero ora e' il buffer dei messaggi di PRINT (circa 38.000
       caratteri per batch in SSMS/SqlClient): oltre quella soglia il client
       non riceve piu' i messaggi successivi. Se la stampa e' piu' lunga
       usare @MaxRighe, oppure stampare in piu' chiamate per intervalli.
       (Non e' piu' il limite di 8000 byte di STRING_AGG: quello e' risolto.)
     - @SeparaRighe = NULL produce il default CR+LF. Per un separatore
       "calcolato" (es. NCHAR(10)) serve una variabile: EXEC non accetta
       funzioni come valore di parametro.
     - @Filtro e @Ordine sono testo dinamico fornito dal chiamante: non vengono
       validati (serve il permesso SELECT sulla tabella, non altro).
     - I caratteri Unicode non rappresentabili nella code page del client
       possono uscire come '?': e' un limite di PRINT, non della store.
   ============================================================================ */

SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER PROCEDURE [dbo].[sp_PrintTable]
(
     @Tabella             nvarchar(776)          -- 'tabella', 'schema.tabella' o 'db.schema.tabella'
    ,@Schema              sysname       = NULL   -- schema (default dbo)
    ,@Filtro              nvarchar(max) = NULL   -- WHERE opzionale, senza "WHERE"
    ,@Ordine              nvarchar(max) = NULL   -- ORDER BY opzionale, senza "ORDER BY"
    ,@SeparaColonne       nvarchar(20)  = N' | '
    ,@SeparaRighe         nvarchar(20)  = NULL   -- NULL = a capo (CR+LF): il default di un
                                                 -- parametro non ammette NCHAR()/funzioni
    ,@MostraIntestazione  bit           = 1
    ,@MaxRighe            int           = NULL   -- NULL / <=0 = tutte le righe
    ,@Debug               bit           = 0
    ,@Righe               int           = NULL OUTPUT
)
AS
BEGIN
    SET NOCOUNT ON;

    /* default reale del separatore di riga: un parametro non puo' avere
       NCHAR(13) + NCHAR(10) come valore di default */
    SET @SeparaRighe = ISNULL(@SeparaRighe, NCHAR(13) + NCHAR(10));

    DECLARE @Db           sysname;
    DECLARE @NomeCompleto nvarchar(800);
    DECLARE @SelectList   nvarchar(max);
    DECLARE @Intestazione nvarchar(max);
    DECLARE @TotCol       int;
    DECLARE @Msg          nvarchar(4000);
    DECLARE @Where        nvarchar(max);
    DECLARE @OrderBy      nvarchar(max);
    DECLARE @Resto        nvarchar(800);
    DECLARE @Parte        nvarchar(776);
    DECLARE @Chiusa       int;
    DECLARE @SepColCod    nvarchar(50);
    DECLARE @SqlCount     nvarchar(max);
    DECLARE @TopN         bigint;
    DECLARE @SepRigheSql  nvarchar(100);
    DECLARE @SepRigheLen  int;
    DECLARE @SqlBlocco    nvarchar(max);
    DECLARE @Blocco       nvarchar(max);
    DECLARE @Offset       bigint = 0;
    DECLARE @Da           bigint;
    DECLARE @TotRighe     bigint;
    DECLARE @Pos          int;
    DECLARE @RighePerBlocco int = 40;   -- righe per gruppo: basso abbastanza da
                                        -- restare sotto gli 8000 byte anche con
                                        -- tabelle molto larghe

    SET @Righe = 0;

    /* ------------------------------------------------------------------
       1. Nome tabella / schema / database + controlli di esistenza
       ------------------------------------------------------------------ */
    SET @Tabella = NULLIF(LTRIM(RTRIM(@Tabella)), N'');
    SET @Schema  = NULLIF(LTRIM(RTRIM(@Schema )), N'');

    IF @Tabella IS NULL
    BEGIN
        RAISERROR(N'sp_PrintTable: parametro @Tabella obbligatorio.', 16, 1);
        RETURN 1;
    END

    /* accetta 'tabella', 'schema.tabella' e 'db.schema.tabella',
       anche con [parentesi quadre].
       Leggo gli identificatori in ordine e li raccolgo: il piu' a destra e'
       la tabella, il precedente lo schema, quello prima il database. */
    DECLARE @Parti table (ord int IDENTITY(1,1) PRIMARY KEY, nome nvarchar(776));

    SET @Resto  = @Tabella;
    SET @Db     = NULL;
    SET @Schema = NULL;

    WHILE @Resto IS NOT NULL AND @Resto <> N''
    BEGIN
        SET @Resto = LTRIM(@Resto);

        IF LEFT(@Resto, 1) = N'['
        BEGIN
            /* identificatore fra parentesi quadre: fino alla ']' (]] = ] letterale) */
            SET @Chiusa = CHARINDEX(N']', @Resto);
            IF @Chiusa > 1
                SET @Parte = REPLACE(SUBSTRING(@Resto, 2, @Chiusa - 2), N']]', N']');
            ELSE
                SET @Parte = NULL;   -- ']' mancante: nome non valido

            SET @Resto = CASE WHEN @Chiusa > 1
                              THEN LTRIM(SUBSTRING(@Resto, @Chiusa + 1, 800))
                              ELSE N'' END;
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

        /* il punto separatore rimasto davanti va scartato */
        IF LEFT(@Resto, 1) = N'.'
            SET @Resto = LTRIM(SUBSTRING(@Resto, 2, 800));

        INSERT INTO @Parti (nome) VALUES (NULLIF(@Parte, N''));
    END

    IF (SELECT COUNT(*) FROM @Parti) = 0
    BEGIN
        RAISERROR(N'sp_PrintTable: parametro @Tabella obbligatorio.', 16, 1);
        RETURN 1;
    END

    SELECT @Tabella = nome
      FROM @Parti
     WHERE ord = (SELECT MAX(ord) FROM @Parti);

    SELECT @Schema = nome
      FROM @Parti
     WHERE ord = (SELECT MAX(ord) - 1 FROM @Parti);

    IF (SELECT COUNT(*) FROM @Parti) >= 3
        SELECT @Db = nome
          FROM @Parti
         WHERE ord = (SELECT MAX(ord) - 2 FROM @Parti);

    SET @Schema  = ISNULL(NULLIF(@Schema, N''), N'dbo');
    SET @Tabella = ISNULL(@Tabella, N'');

    IF @Debug = 1
    BEGIN
        SET @Msg = N'[sp_PrintTable] db=[' + ISNULL(@Db, N'<NULL>')
                 + N'] schema=[' + ISNULL(@Schema, N'<NULL>')
                 + N'] tabella=[' + ISNULL(@Tabella, N'<NULL>') + N']';
        PRINT @Msg;
    END

    /* nomi qualificati e messi al sicuro (gestisce spazi, punti, riservate, ecc.).
       Attenzione: QUOTENAME(NULL) e' NULL, quindi il database va controllato a parte. */
    IF @Tabella IS NULL OR @Tabella = N'' OR QUOTENAME(@Tabella) IS NULL
       OR QUOTENAME(@Schema) IS NULL
       OR (@Db IS NOT NULL AND QUOTENAME(@Db) IS NULL)
    BEGIN
        RAISERROR(N'sp_PrintTable: nome database/schema/tabella non valido.', 16, 1);
        RETURN 1;
    END

    SET @NomeCompleto = CASE WHEN @Db IS NULL THEN N'' ELSE QUOTENAME(@Db) + N'.' END
                     + QUOTENAME(@Schema) + N'.' + QUOTENAME(@Tabella);

    IF OBJECT_ID(@NomeCompleto, N'U') IS NULL
    BEGIN
        SET @Msg = N'sp_PrintTable: la tabella ' + @NomeCompleto
                 + N' non esiste (o non e'' una tabella utente).';
        RAISERROR(@Msg, 16, 1);
        RETURN 1;
    END

    /* WHERE / ORDER BY ripuliti una volta sola.
       OFFSET/FETCH richiede SEMPRE una ORDER BY: se il chiamante non la passa
       si usa la chiave primaria (ordine stabile) oppure un ordine libero. */
    SET @Where = NULLIF(LTRIM(RTRIM(@Filtro)), N'');

    SET @OrderBy = NULLIF(LTRIM(RTRIM(@Ordine)), N'');
    IF @OrderBy IS NULL
    BEGIN
        SET @OrderBy = STUFF((
            SELECT N', ' + QUOTENAME(c.name)
              FROM sys.indexes AS i
              JOIN sys.index_columns AS ic
                ON ic.object_id = i.object_id AND ic.index_id = i.index_id
              JOIN sys.columns AS c
                ON c.object_id = ic.object_id AND c.column_id = ic.column_id
             WHERE i.object_id   = OBJECT_ID(@NomeCompleto)
               AND i.is_primary_key = 1
               AND ic.is_included_column = 0
             ORDER BY ic.key_ordinal
               FOR XML PATH(''), TYPE
            ).value('.', 'nvarchar(max)'), 1, 2, N'');
    END
    IF @OrderBy IS NULL
        SET @OrderBy = N'(SELECT NULL)';

    IF @Debug = 1
    BEGIN
        SET @Msg = N'[sp_PrintTable] tabella = ' + @NomeCompleto;
        PRINT @Msg;
    END

    /* ------------------------------------------------------------------
       2. Lista colonne + intestazione: tutte le colonne leggibili,
          in ordine di column_id (fuori generate/sparse/criptate e quelle
          su cui non si ha il permesso SELECT)
       ------------------------------------------------------------------ */
    SELECT @TotCol = COUNT(*)
      FROM sys.columns AS c
     WHERE c.object_id             = OBJECT_ID(@NomeCompleto)
       AND c.is_hidden             = 0
       AND c.generated_always_type = 0
       AND ISNULL(COLUMNPROPERTY(c.object_id, c.name, N'IsEncrypted'), 0) = 0
       AND HAS_PERMS_BY_NAME(@NomeCompleto, N'OBJECT', N'SELECT', c.name, N'COLUMN') = 1;

    IF @TotCol = 0
    BEGIN
        SET @Msg = N'sp_PrintTable: nessuna colonna leggibile su ' + @NomeCompleto + N'.';
        RAISERROR(@Msg, 16, 1);
        RETURN 1;
    END

    /* STRING_AGG accetta come separatore SOLO un letterale o una variabile:
       il codice del separatore va quindi preparato prima in una variabile
       (errore 8733 se si passa un'espressione).
       Qui aggrega solo i NOMI delle colonne: il limite di 8000 byte non e'
       raggiungibile, quindi non serve il lavoro a blocchi. */
    SET @SepColCod = N' + N' + ISNULL(QUOTENAME(@SeparaColonne, N''''), N'N''''') + N' + ';

    SELECT @SelectList = STRING_AGG(
                            N'ISNULL(CONVERT(nvarchar(max), ' + QUOTENAME(c.name) + N'), N''<NULL>'')',
                            @SepColCod)
                         WITHIN GROUP (ORDER BY c.column_id)
      FROM sys.columns AS c
     WHERE c.object_id             = OBJECT_ID(@NomeCompleto)
       AND c.is_hidden             = 0
       AND c.generated_always_type = 0
       AND ISNULL(COLUMNPROPERTY(c.object_id, c.name, N'IsEncrypted'), 0) = 0
       AND HAS_PERMS_BY_NAME(@NomeCompleto, N'OBJECT', N'SELECT', c.name, N'COLUMN') = 1;

    SELECT @Intestazione = STRING_AGG(CAST(c.name AS nvarchar(max)), @SeparaColonne)
                           WITHIN GROUP (ORDER BY c.column_id)
      FROM sys.columns AS c
     WHERE c.object_id             = OBJECT_ID(@NomeCompleto)
       AND c.is_hidden             = 0
       AND c.generated_always_type = 0
       AND ISNULL(COLUMNPROPERTY(c.object_id, c.name, N'IsEncrypted'), 0) = 0
       AND HAS_PERMS_BY_NAME(@NomeCompleto, N'OBJECT', N'SELECT', c.name, N'COLUMN') = 1;

    IF @Debug = 1
    BEGIN
        SET @Msg = N'[sp_PrintTable] colonne: ' + CONVERT(nvarchar(10), @TotCol);
        PRINT @Msg;
    END

    /* ------------------------------------------------------------------
       3. Intestazione
       ------------------------------------------------------------------ */
    IF @MostraIntestazione = 1
    BEGIN
        SET @Msg = N'--- ' + @NomeCompleto
                 + CASE WHEN @Where IS NOT NULL THEN N'   (WHERE ' + @Where + N')' ELSE N'' END
                 + N' ---';
        PRINT @Msg;
        PRINT @Intestazione;
    END

    /* ------------------------------------------------------------------
       4. Quante righe verranno stampate
       ------------------------------------------------------------------ */
    SET @TopN = CASE WHEN ISNULL(@MaxRighe, 0) > 0
                     THEN CONVERT(bigint, @MaxRighe)
                     ELSE CONVERT(bigint, 9223372036854775807) END;

    SET @SqlCount =
          N'SELECT @CntOut = COUNT(*)'
        + N' FROM (SELECT TOP (@TopN) 1 AS x'
        + N' FROM ' + @NomeCompleto
        + CASE WHEN @Where IS NOT NULL THEN N' WHERE ' + @Where ELSE N'' END
        + N' ORDER BY ' + @OrderBy
        + N') AS q;';

    EXEC sys.sp_executesql
         @SqlCount,
         N'@CntOut int OUTPUT, @TopN bigint',
         @CntOut = @Righe OUTPUT,
         @TopN   = @TopN;

    /* ------------------------------------------------------------------
       5. Testo "mergeato": gruppi di righe con FOR XML PATH, accumulati in
          una variabile (nessun limite di 8000 byte) e stampati a blocchi da
          4000 caratteri (limite di PRINT).

          Il separatore di riga non deve restare in coda all'ultima riga: qui
          viene accodato a ogni riga del gruppo e poi tolto con STUFF; tra un
          gruppo e il successivo lo antepone l'istruzione finale.
       ------------------------------------------------------------------ */
    /* Il separatore di riga diventa un'espressione dentro il SQL dinamico:
       @SepRigheSql e' il contenuto compreso fra due apici (che aggiungono i
       punti di uso). I caratteri di controllo non possono stare dentro un
       letterale, quindi ogni pezzo viene chiuso, concatenato con CHAR(n) e
       riaperto: CR+LF diventa  '' + CHAR(13) + CHAR(10) + ''  e, incapsulato,
       diventa  N'' + CHAR(13) + CHAR(10) + N'...'.
       Nota: si usa CHAR() e non NCHAR() nelle sostituzioni, perche' il testo
       inserito non deve contenere caratteri di controllo o apici. */
    SET @SepRigheSql = REPLACE(@SeparaRighe, N'''', N'''''');                    -- ' -> ''
    SET @SepRigheSql = REPLACE(@SepRigheSql, NCHAR(13), N''' + CHAR(13) + ''');
    SET @SepRigheSql = REPLACE(@SepRigheSql, NCHAR(10), N''' + CHAR(10) + ''');
    SET @SepRigheSql = REPLACE(@SepRigheSql, NCHAR(9),  N''' + CHAR(9)  + ''');

    /* Il separatore viene accodato a OGNI riga del gruppo e poi tolto
       dall'ultima con SUBSTRING, cosi' non resta in coda. Il separatore fra la
       prima riga di un gruppo e l'ultima del precedente lo antepone
       l'istruzione finale (@off > 0). */
    SET @SepRigheLen = DATALENGTH(@SeparaRighe) / 2;

    SET @SqlBlocco =
          N'SELECT @blocco = SUBSTRING(('
        + N'    SELECT N''' + @SepRigheSql + N''' + testo AS [text()]'
        + N'    FROM ('
        + N'        SELECT ' + @SelectList + N' AS testo'
        + N'        FROM ' + @NomeCompleto
        + CASE WHEN @Where IS NOT NULL THEN N' WHERE ' + @Where ELSE N'' END
        + N'        ORDER BY ' + @OrderBy
        + N'        OFFSET @off ROWS FETCH NEXT @n ROWS ONLY'
        + N'    ) AS pagina'
        + N'    FOR XML PATH(''''), TYPE'
        + N').value(''.'', ''nvarchar(max)''), ' + CONVERT(nvarchar(10), @SepRigheLen + 1) + N', 2147483647);'
        + N' IF @off > 0 SET @blocco = N''' + @SepRigheSql + N''' + @blocco;';

    IF @Debug = 1
    BEGIN
        SET @Msg = N'[sp_PrintTable] SQL blocco: ' + LEFT(@SqlBlocco, 3500);
        PRINT @Msg;
    END

    SET @TotRighe = ISNULL(@Righe, 0);
    SET @Offset   = 0;

    WHILE @Offset < @TotRighe
    BEGIN
        SET @Da = @RighePerBlocco;
        IF @Offset + @Da > @TotRighe SET @Da = @TotRighe - @Offset;

        SET @Blocco = NULL;

        EXEC sys.sp_executesql
             @SqlBlocco,
             N'@blocco nvarchar(max) OUTPUT, @off bigint, @n bigint',
             @blocco = @Blocco OUTPUT,
             @off    = @Offset,
             @n      = @Da;

        IF @Blocco IS NULL SET @Blocco = N'';

        /* stampo subito questo gruppo, spezzato in blocchi da 4000 caratteri */
        SET @Pos = 1;
        WHILE @Pos <= LEN(@Blocco)
        BEGIN
            PRINT SUBSTRING(@Blocco, @Pos, 4000);
            SET @Pos = @Pos + 4000;
        END

        SET @Offset = @Offset + @Da;
    END

    IF @TotRighe = 0
        PRINT N'(nessuna riga da stampare)';

    SET @Msg = N'--- righe stampate: ' + CONVERT(nvarchar(20), @TotRighe)
             + N' / colonne: ' + CONVERT(nvarchar(20), @TotCol) + N' ---';
    PRINT @Msg;

    RETURN 0;
END
GO
