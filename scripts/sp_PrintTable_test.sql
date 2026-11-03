/* ============================================================================
   Test d'uso di dbo.sp_PrintTable
   ----------------------------------------------------------------------------
   Crea una tabella di prova, la stampa in diversi modi e poi la cancella.
   Eseguire DOPO scripts/sp_PrintTable.sql (che crea la store).
   Richiede SQL Server 2017+ (STRING_AGG).
   ============================================================================ */

SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TEST_STAMPA', N'U') IS NOT NULL DROP TABLE dbo.TEST_STAMPA;
GO

CREATE TABLE dbo.TEST_STAMPA
(
     ID       int IDENTITY(1,1) PRIMARY KEY
    ,CODICE   nvarchar(10)  NOT NULL
    ,DESCR    nvarchar(50)  NULL
    ,QTA      decimal(9,2)  NULL
    ,DATA_REG datetime2(0)  CONSTRAINT DF_TEST_STAMPA_DATA DEFAULT SYSDATETIME()
    ,FLAG     bit           CONSTRAINT DF_TEST_STAMPA_FLAG DEFAULT 0
    ,NOTE     nvarchar(max) NULL
);
GO

INSERT INTO dbo.TEST_STAMPA (CODICE, DESCR, QTA, FLAG, NOTE) VALUES
     (N'A01', N'Riga uno',   10.50, 1, N'nota 1'),
     (N'A02', N'Riga due',    0.00, 0, NULL),
     (N'A03', N'Riga tre',   -3.25, 1, N'nota con | separatore'),
     (N'A04', NULL,            NULL, 0, N'descrizione mancante');
GO

/* ---------------------------------------------------------------------------
   1) stampa completa: intestazione + tutte le righe
   --------------------------------------------------------------------------- */
PRINT N'=========== 1) stampa completa ===========';
EXEC dbo.sp_PrintTable @Tabella = N'dbo.TEST_STAMPA';
GO

/* ---------------------------------------------------------------------------
   2) solo alcune righe, ordine decrescente, separatori personalizzati
   --------------------------------------------------------------------------- */
PRINT N'=========== 2) filtro + ordine + separatori ===========';
EXEC dbo.sp_PrintTable
     @Tabella        = N'dbo.TEST_STAMPA',
     @Filtro         = N'FLAG = 1',
     @Ordine         = N'ID DESC',
     @SeparaColonne  = N' ; ',
     @SeparaRighe    = N' || ',
     @Debug          = 1;
GO

/* ---------------------------------------------------------------------------
   3) senza intestazione, max 2 righe, separatore di riga a capo singolo.
      Nota: EXEC accetta come valore di parametro solo un letterale o una
      variabile, NON una funzione -> NCHAR(10) va messo in una variabile.
   --------------------------------------------------------------------------- */
PRINT N'=========== 3) senza intestazione, top 2 ===========';
DECLARE @aCapo nvarchar(20) = NCHAR(10);

EXEC dbo.sp_PrintTable
     @Tabella            = N'TEST_STAMPA',   -- schema omesso: diventa dbo
     @MostraIntestazione = 0,
     @MaxRighe           = 2,
     @SeparaRighe        = @aCapo;
GO

/* ---------------------------------------------------------------------------
   4) lettura del parametro di OUTPUT
   --------------------------------------------------------------------------- */
DECLARE @RigheStampate int;

EXEC dbo.sp_PrintTable
     @Tabella = N'dbo.TEST_STAMPA',
     @Filtro  = N'QTA IS NOT NULL',
     @Righe   = @RigheStampate OUTPUT;

PRINT N'righe tornate dal parametro OUTPUT: ' + CONVERT(nvarchar(20), @RigheStampate);
GO

/* ---------------------------------------------------------------------------
   5) casi limite: tabella vuota e tabella inesistente
   --------------------------------------------------------------------------- */
PRINT N'=========== 5a) tabella vuota ===========';
DELETE FROM dbo.TEST_STAMPA;
EXEC dbo.sp_PrintTable @Tabella = N'dbo.TEST_STAMPA';
GO

PRINT N'=========== 5b) tabella inesistente (errore atteso) ===========';
BEGIN TRY
    EXEC dbo.sp_PrintTable @Tabella = N'dbo.NON_ESISTE';
END TRY
BEGIN CATCH
    PRINT N'errore catturato: ' + ERROR_MESSAGE();
END CATCH
GO

/* ---------------------------------------------------------------------------
   6) casi particolari: nome con spazio, nome quotato, nome a 3 parti
   --------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.[Tabella Con Spazio]', N'U') IS NOT NULL DROP TABLE dbo.[Tabella Con Spazio];
GO
CREATE TABLE dbo.[Tabella Con Spazio] (A int, B nvarchar(20));
INSERT INTO dbo.[Tabella Con Spazio] (A, B) VALUES (1, N'uno'), (2, N'due');
GO

PRINT N'=========== 6a) nome con spazio (non quotato) ===========';
EXEC dbo.sp_PrintTable @Tabella = N'dbo.Tabella Con Spazio';
GO

PRINT N'=========== 6b) nome quotato ===========';
EXEC dbo.sp_PrintTable @Tabella = N'[dbo].[Tabella Con Spazio]';
GO

PRINT N'=========== 6c) nome a 3 parti (db.schema.tabella) ===========';
EXEC dbo.sp_PrintTable @Tabella = N'master.dbo.TEST_STAMPA', @MaxRighe = 1, @Debug = 1;
GO

DROP TABLE dbo.[Tabella Con Spazio];
DROP TABLE dbo.TEST_STAMPA;
GO
/* ---------------------------------------------------------------------------
   7) verifica esatta del testo stampato: 100 righe con separatore noto.
      Il client ricostruisce il testo dai messaggi PRINT (che si spezzano ogni
      4000 caratteri) e controlla che i separatori siano esattamente 99 e che
      ogni riga ci sia una volta sola.
   --------------------------------------------------------------------------- */
IF OBJECT_ID(N'dbo.TEST_VERIFICA', N'U') IS NOT NULL DROP TABLE dbo.TEST_VERIFICA;
GO
CREATE TABLE dbo.TEST_VERIFICA (ID int IDENTITY(1,1) PRIMARY KEY, CODICE nvarchar(10));
INSERT INTO dbo.TEST_VERIFICA (CODICE)
SELECT N'C' + RIGHT(N'000' + CONVERT(nvarchar(10), t.n), 3)
  FROM (SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects) AS t
 WHERE t.n <= 100;
GO
PRINT N'=== 7) 100 righe, separatore " ; " ===';
EXEC dbo.sp_PrintTable @Tabella = N'dbo.TEST_VERIFICA', @MostraIntestazione = 0, @SeparaRighe = N' ; ';
GO
DROP TABLE dbo.TEST_VERIFICA;
GO
