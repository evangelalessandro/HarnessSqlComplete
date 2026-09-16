/*
 Import Avvisi
*/
/*

 Notices import
 
*/
CREATE OR ALTER PROCEDURE [dbo].[ws_L2_Host_Import_Avvisi]
(
        @pOPERAZIONE NVARCHAR(max) = NULL /* "A" = Solo Insert (e' il default se null), Operazione "I" = Insert o update, "D" = Delete */ /* "A" = Only insert (if null is the default), Operation 'I' = Insert or Update, "D" = Delete */
        ,@pSPLIT BIT = NULL /* Se 1, esegue lo split, se 0 non lo esegue, se null lo ricava dal campo dell'ordine dell'avviso ingresso */ /* If 1, does the split, if 0 does not execute it, if null the input of the notice of the order is obtained from the field */ /**/
        ,@pRIG_ARTICOLO NVARCHAR(max) = NULL
        ,@pRIG_SUB1 NVARCHAR(max) = NULL
        ,@pRIG_SUB2 NVARCHAR(max) = NULL
        ,@pRIG_STAMATE NVARCHAR(5) = NULL
        ,@pRIG_TIPOCONF NVARCHAR(5) = NULL
        ,@pRIG_HOSTINF NVARCHAR(max) = NULL
        ,@pRIG_QTAR DECIMAL(11, 3) = NULL
        ,@pRIG_REQ_NOTE NVARCHAR(max) = NULL
        ,@pRIG_HOSTCAUS NVARCHAR(5) = NULL
        ,@pRIG_SSCC_SOURCE NVARCHAR(max) = NULL
        ,@pRIG_DPRO NVARCHAR(max) = NULL
        ,@pRIG_DSCA NVARCHAR(max) = NULL
        ,@pRIG_AVVISO_UDCPRED NVARCHAR(5) = NULL
        ,@pRIG_LU_CODE NVARCHAR(20) = NULL
)
AS
SET NOCOUNT ON
SET XACT_ABORT ON

/* Di default, impone 'A' come operazione */
/* Set 'A' as default operation */
IF @pOPERAZIONE IS NULL
  SELECT @pOPERAZIONE = 'A'

/* Ricavo ordine avvisi di ingresso */
DECLARE @ordine NVARCHAR(max)
       ,@errore NVARCHAR(max)
SELECT @ordine = '_AVVISI INGRESSO_'

/* Normalizzazione valori */
SELECT @pRIG_ARTICOLO = rtrim (@pRIG_ARTICOLO), @pRIG_SUB1 = rtrim (@pRIG_SUB1), @pRIG_SUB2 = rtrim (@pRIG_SUB2), @pRIG_STAMATE = IIF (ISNULL (@pRIG_LU_CODE, '') = '', 'Q', upper (rtrim (@pRIG_STAMATE))) /*per l'handling simulation*/, @pRIG_TIPOCONF = upper (rtrim (@pRIG_TIPOCONF)), @pRIG_HOSTINF = rtrim (isnull (@pRIG_HOSTINF, '')), @pRIG_REQ_NOTE = rtrim (@pRIG_REQ_NOTE), @pRIG_HOSTCAUS = rtrim (@pRIG_HOSTCAUS), @pRIG_DPRO = rtrim (@pRIG_DPRO), @pRIG_DSCA = rtrim (@pRIG_DSCA), @pRIG_LU_CODE = ISNULL (RTRIM (@pRIG_LU_CODE), '')

/* Check HOSTINF value */
IF @pRIG_HOSTINF = ''
BEGIN
  SELECT @errore = dbo.fn_td ('Campo HOSTINF non impostato')
  RAISERROR (@errore, 16, 1)
  RETURN - 1
END

/* Prelevo dati avviso gia' esistente */
DECLARE @idriga INT
SELECT @idriga = RIG_RIGA
FROM DAT_ORDINI_RIGHE
WHERE RIG_ORDINE = @ordine
      AND RIG_HOST = 1
      AND RIG_HOSTINF = @pRIG_HOSTINF
IF @@ERROR <> 0
  RETURN - 1

/* Cancellazione */
IF (@pOPERAZIONE = 'D')
BEGIN
  IF @idriga > 0
  BEGIN
    /* Marco come esportata */
    UPDATE DAT_ORDINI_RIGHE
      SET RIG_EXPORDINE = 'COMPL'
    WHERE RIG_RIGA = @idriga
          AND RIG_NESE = 0

    /* Elimino la riga */
    DELETE
    FROM DAT_ORDINI_RIGHE
    WHERE RIG_RIGA = @idriga
          AND RIG_EXPORDINE = 'COMPL'
    IF @@ROWCOUNT < 1
    BEGIN
      SELECT @errore = dbo.fn_td ('Riga non eliminabile')
      RAISERROR (@errore, 16, 1)
      RETURN - 1
    END

  END
  RETURN 0
END

/* Update */
IF @pOPERAZIONE = 'I' AND @idriga > 0
BEGIN
  UPDATE DAT_ORDINI_RIGHE
    SET RIG_QTAR = isnull (@pRIG_QTAR, RIG_QTAR)
        ,RIG_REQ_NOTE = isnull (@pRIG_REQ_NOTE, RIG_REQ_NOTE)
  WHERE RIG_RIGA = @idriga
  RETURN 0
END

/* Se inserimento e riga duplicata, genero errore */
IF @pOPERAZIONE = 'A' AND @idriga > 0
BEGIN
  SELECT @errore = dbo.fn_td ('Riga duplicata')
  RAISERROR (@errore, 16, 1)
  RETURN - 1
END

/* Inserimento (ed eventuale split) */
IF @pOPERAZIONE IN ('I', 'A')
BEGIN
 INSERT INTO DAT_ORDINI_RIGHE (RIG_ORDINE, RIG_ARTICOLO, RIG_SUB1, RIG_SUB2, RIG_STAMATE, RIG_TIPOCONF, RIG_HOSTINF, RIG_QTAR, RIG_REQ_NOTE, RIG_HOSTCAUS, RIG_HOST, RIG_SSCC_SOURCE, RIG_AVVISO_DPRO, RIG_AVVISO_DSCA, RIG_AVVISO_UDCPRED, RIG_AVVISO_LU_CODE, RIG_AVVISO_SSCC)
VALUES (@ordine, @pRIG_ARTICOLO, isnull (@pRIG_SUB1, ''), isnull (@pRIG_SUB2, ''), isnull (@pRIG_STAMATE, ''), isnull (@pRIG_TIPOCONF, ''), @pRIG_HOSTINF, @pRIG_QTAR, isnull (@pRIG_REQ_NOTE, ''), ISNULL (@pRIG_HOSTCAUS, ''), 1, isnull (@pRIG_SSCC_SOURCE, ''), CASE WHEN @pRIG_DPRO > '' THEN dbo.fn_Uti_StringToDateTime (@pRIG_DPRO, 'yyyy-MM-dd hh') ELSE '' END, CASE WHEN @pRIG_DSCA > '' THEN dbo.fn_Uti_StringToDateTime (@pRIG_DSCA, 'yyyy-MM-dd hh') ELSE '' END, isnull (@pRIG_AVVISO_UDCPRED, ''), @pRIG_LU_CODE, @pRIG_LU_CODE)

  SELECT @idriga = SCOPE_IDENTITY ()

  /* Se richiesto esegue lo split */
  DECLARE @retval INT
  IF @pSPLIT IS NULL
    SELECT @pSPLIT =
      CASE
        WHEN ORD_ATTRIBUTES LIKE '%,SPLIT:STANDARD,%'
          THEN 1
        ELSE 0
      END
      FROM DAT_ORDINI
    WHERE ORD_ORDINE = @ordine
  IF @pSPLIT = 1
  BEGIN
    EXEC @retVal = ws_L2_SplitRiga @idriga
        ,@errore OUTPUT
    IF @retVal <> 0
    BEGIN
      RAISERROR (@errore, 16, 1)
      RETURN - 1
    END
  END

  RETURN 0
END

/* Errore tipo operazione errata */
SELECT @errore = dbo.fn_InsTextStr (dbo.fn_td ('Tipo di operazione "{0}" non prevista'), isnull (@pOPERAZIONE, ''), DEFAULT, DEFAULT, DEFAULT, DEFAULT)
RAISERROR (@errore, 16, 1)
RETURN - 1
