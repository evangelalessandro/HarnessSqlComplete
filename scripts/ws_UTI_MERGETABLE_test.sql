/* ============================================================================
   Test di dbo.ws_UTI_MERGETABLE
   ----------------------------------------------------------------------------
   Crea due database (MERGE_SRC e MERGE_DST) con la stessa tabella ma dati
   diversi, e prova le due modalita':
     'Nomi'   -> la MERGE legge dalla tabella sorgente
     'Valori' -> la MERGE ha i dati scritti dentro (script autonomo)
   Eseguire DOPO scripts/ws_UTI_MERGETABLE.sql
   ============================================================================ */

USE master;
GO
IF DB_ID(N'MERGE_SRC') IS NOT NULL BEGIN ALTER DATABASE MERGE_SRC SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE MERGE_SRC; END
IF DB_ID(N'MERGE_DST') IS NOT NULL BEGIN ALTER DATABASE MERGE_DST SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE MERGE_DST; END
GO
CREATE DATABASE MERGE_SRC;
GO
CREATE DATABASE MERGE_DST;
GO

/* --- struttura: identity, calcolata, rowversion, default, tipi vari --- */
CREATE TABLE MERGE_SRC.dbo.CLIENTI
(
     ID        int IDENTITY(1,1) PRIMARY KEY
    ,CODICE    nvarchar(10)  NOT NULL
    ,DESCR     nvarchar(100) NULL
    ,QTA       decimal(9,2)  NOT NULL CONSTRAINT DF_SRC_QTA DEFAULT (0)
    ,DATA_REG  datetime2(0)  NOT NULL CONSTRAINT DF_SRC_DATA DEFAULT (SYSDATETIME())
    ,FLAG      bit           NOT NULL CONSTRAINT DF_SRC_FLAG DEFAULT (0)
    ,GUID      uniqueidentifier NULL
    ,BIN       varbinary(8)  NULL
    ,TOT       AS (QTA * 2)
    ,RV        rowversion
    ,SOLO_SRC  nvarchar(20)  NULL          -- colonna presente solo nella sorgente
);
GO
CREATE TABLE MERGE_DST.dbo.CLIENTI
(
     ID        int IDENTITY(1,1) PRIMARY KEY
    ,CODICE    nvarchar(10)  NOT NULL
    ,DESCR     nvarchar(100) NULL
    ,QTA       decimal(9,2)  NOT NULL CONSTRAINT DF_DST_QTA DEFAULT (0)
    ,DATA_REG  datetime2(0)  NOT NULL CONSTRAINT DF_DST_DATA DEFAULT (SYSDATETIME())
    ,FLAG      bit           NOT NULL CONSTRAINT DF_DST_FLAG DEFAULT (0)
    ,GUID      uniqueidentifier NULL
    ,BIN       varbinary(8)  NULL
    ,TOT       AS (QTA * 2)
    ,RV        rowversion
    ,SOLO_DST  nvarchar(20)  NULL          -- colonna presente solo nella destinazione
);
GO

/* --- dati: 1 da aggiornare, 1 solo in destinazione, 1 solo in sorgente --- */
INSERT INTO MERGE_SRC.dbo.CLIENTI (CODICE, DESCR, QTA, DATA_REG, FLAG, GUID, BIN, SOLO_SRC) VALUES
     (N'A01', N'apostrofo: l''albero', 11.00, '2024-03-05T14:22:33', 1, '11111111-2222-3333-4444-555555555555', 0x0102, N'x'),
     (N'A03', N'virgola, e parentesi )', 30.00, '2020-12-31T23:59:59', 1, '99999999-8888-7777-6666-555555555555', 0xAB, N'z');
INSERT INTO MERGE_DST.dbo.CLIENTI (CODICE, DESCR, QTA, DATA_REG, FLAG, SOLO_DST) VALUES
     (N'A01', N'valore vecchio', 1.00, '2000-01-01T00:00:00', 0, N'k'),
     (N'A02', N'solo destinazione', 2.00, '2001-01-01T00:00:00', 1, N'k');
GO

/* ===========================================================================
   1) MODALITA' 'Nomi': la MERGE legge dalla sorgente
   =========================================================================== */
PRINT N'=========== 1) modalita Nomi: script generato ===========';
DECLARE @sql nvarchar(max);
EXEC dbo.ws_UTI_MERGETABLE
     @Sorgente     = N'MERGE_SRC.dbo.CLIENTI',
     @Destinazione = N'MERGE_DST.dbo.CLIENTI',
     @Chiave       = N'CODICE',
     @Script       = @sql OUTPUT;
GO

PRINT N'=========== 2) modalita Nomi: esecuzione e risultato ===========';
DECLARE @sql nvarchar(max);
EXEC dbo.ws_UTI_MERGETABLE
     @Sorgente     = N'MERGE_SRC.dbo.CLIENTI',
     @Destinazione = N'MERGE_DST.dbo.CLIENTI',
     @Chiave       = N'CODICE',
     @Script       = @sql OUTPUT;
EXEC sys.sp_executesql @sql;
SELECT ID, CODICE, DESCR, QTA, SOLO_DST FROM MERGE_DST.dbo.CLIENTI ORDER BY CODICE;
GO

/* ===========================================================================
   3) MODALITA' 'Valori': script autonomo con i dati dentro
   =========================================================================== */
PRINT N'=========== 3) modalita Valori: script autonomo ===========';
DECLARE @sql nvarchar(max);
EXEC dbo.ws_UTI_MERGETABLE
     @Sorgente     = N'MERGE_SRC.dbo.CLIENTI',
     @Destinazione = N'MERGE_DST.dbo.CLIENTI',
     @Chiave       = N'CODICE',
     @Modo         = N'Valori',
     @Script       = @sql OUTPUT;

PRINT N'--- lunghezza script: ' + CONVERT(nvarchar(20), LEN(@sql));
GO

PRINT N'=========== 4) modalita Valori: rieseguito su tabella svuotata ===========';
DECLARE @sql nvarchar(max);
EXEC dbo.ws_UTI_MERGETABLE
     @Sorgente     = N'MERGE_SRC.dbo.CLIENTI',
     @Destinazione = N'MERGE_DST.dbo.CLIENTI',
     @Chiave       = N'CODICE',
     @Modo         = N'Valori',
     @Script       = @sql OUTPUT;

/* si tolgono le righe trasferite: lo script deve ricostruirle da solo,
   senza leggere la sorgente */
DELETE FROM MERGE_DST.dbo.CLIENTI WHERE CODICE IN (N'A01', N'A03');
EXEC sys.sp_executesql @sql;

SELECT ID, CODICE, DESCR, QTA, SOLO_DST FROM MERGE_DST.dbo.CLIENTI ORDER BY CODICE;

SELECT COUNT(*) AS differenze FROM (
    SELECT CODICE, DESCR, QTA, DATA_REG, FLAG, GUID, BIN FROM MERGE_SRC.dbo.CLIENTI
    EXCEPT
    SELECT CODICE, DESCR, QTA, DATA_REG, FLAG, GUID, BIN FROM MERGE_DST.dbo.CLIENTI) AS d;
GO

/* ===========================================================================
   5) varianti
   =========================================================================== */
PRINT N'=========== 5a) chiave presa dalla PRIMARY KEY (ID) ===========';
EXEC dbo.ws_UTI_MERGETABLE @Sorgente = N'MERGE_SRC.dbo.CLIENTI',
                           @Destinazione = N'MERGE_DST.dbo.CLIENTI';
GO

PRINT N'=========== 5b) esclusione colonne ===========';
EXEC dbo.ws_UTI_MERGETABLE @Sorgente = N'MERGE_SRC.dbo.CLIENTI',
                           @Destinazione = N'MERGE_DST.dbo.CLIENTI',
                           @Chiave = N'CODICE',
                           @EscludiColonne = N'DATA_REG, DESCR, FLAG';
GO

PRINT N'=========== 5c) identity trasferita (modalita Valori) ===========';
EXEC dbo.ws_UTI_MERGETABLE @Sorgente = N'MERGE_SRC.dbo.CLIENTI',
                           @Destinazione = N'MERGE_DST.dbo.CLIENTI',
                           @Chiave = N'ID',
                           @IncludiIdentity = 1,
                           @Modo = N'Valori';
GO

PRINT N'=========== 5d) Valori con blocco da 1 riga e top 1 ===========';
EXEC dbo.ws_UTI_MERGETABLE @Sorgente = N'MERGE_SRC.dbo.CLIENTI',
                           @Destinazione = N'MERGE_DST.dbo.CLIENTI',
                           @Chiave = N'CODICE',
                           @Modo = N'Valori',
                           @RighePerBlocco = 1,
                           @MaxRighe = 1;
GO

/* ===========================================================================
   6) errori attesi
   =========================================================================== */
PRINT N'=========== 6a) chiave inesistente ===========';
BEGIN TRY
    EXEC dbo.ws_UTI_MERGETABLE @Sorgente = N'MERGE_SRC.dbo.CLIENTI',
                               @Destinazione = N'MERGE_DST.dbo.CLIENTI',
                               @Chiave = N'COLONNA_INESISTENTE';
END TRY
BEGIN CATCH
    PRINT N'errore catturato: ' + ERROR_MESSAGE();
END CATCH
GO

PRINT N'=========== 6b) tabella inesistente ===========';
BEGIN TRY
    EXEC dbo.ws_UTI_MERGETABLE @Sorgente = N'MERGE_SRC.dbo.NON_ESISTE',
                               @Destinazione = N'MERGE_DST.dbo.CLIENTI';
END TRY
BEGIN CATCH
    PRINT N'errore catturato: ' + ERROR_MESSAGE();
END CATCH
GO

PRINT N'=========== 6c) modo non valido ===========';
BEGIN TRY
    EXEC dbo.ws_UTI_MERGETABLE @Sorgente = N'MERGE_SRC.dbo.CLIENTI',
                               @Destinazione = N'MERGE_DST.dbo.CLIENTI',
                               @Modo = N'Sbagliato';
END TRY
BEGIN CATCH
    PRINT N'errore catturato: ' + ERROR_MESSAGE();
END CATCH
GO

/* --- pulizia --- */
USE master;
GO
IF DB_ID(N'MERGE_SRC') IS NOT NULL BEGIN ALTER DATABASE MERGE_SRC SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE MERGE_SRC; END
IF DB_ID(N'MERGE_DST') IS NOT NULL BEGIN ALTER DATABASE MERGE_DST SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE MERGE_DST; END
GO
