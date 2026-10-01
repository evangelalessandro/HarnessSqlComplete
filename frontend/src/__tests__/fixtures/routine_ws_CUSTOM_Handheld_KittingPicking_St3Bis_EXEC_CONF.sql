/* 
   
   
*/
CREATE OR ALTER PROCEDURE [dbo].[ws_CUSTOM_Handheld_KittingPicking_St3Bis_EXEC_CONF]
(
        @USER          NVARCHAR(50)
        ,@pEseId       NVARCHAR(50)
        ,@pQta         INT
        ,@pEseShortage INT
)
AS
SET NOCOUNT ON
SET XACT_ABORT ON


DECLARE @retVal   INT
       ,@txtError NVARCHAR(max)

/* Transaction */ 
DECLARE @trancount INT = @@trancount
IF @trancount < 1
BEGIN TRANSACTION

DECLARE @rowNum INT
       ,@newScc NVARCHAR(50)
       ,@SU     DECIMAL(15, 0)
CREATE TABLE #tbl_KittingPicking_St2 (
  X_RANK INT
  ,X_ORDINE NVARCHAR(50)
  ,X_NUM_PICKED_PALLET INT
  ,X_SSCC_LU NVARCHAR(50)
  ,X_SKU NVARCHAR(50)
  ,X_SKU_DESC NVARCHAR(50)
  ,X_QTAR INT
  ,X_GIAC INT
  ,X_LU_POSITION NVARCHAR(50)
  ,X_UDC_MADRE DECIMAL(15, 0)
)
EXEC ws_CUSTOM_Handheld_KittingPicking_St2_GetList @USER   = N''
                                                  ,@pEseId = @pEseId
SET @rowNum = @@rowcount
IF @rowNum = 0
BEGIN
  SET @txtError = dbo.fn_td ('No row to exec !')
  GOTO lblExit
END

SELECT UDC_UDC X_SU_CODE
   ,UDC_SSCC X_SSCC_SU
INTO #tmpLu
FROM dat_udc
  INNER JOIN #tbl_KittingPicking_St2 ON X_ORDINE = UDC_ORDINE AND UDC_CNT_STA = 'R' AND UDC_STAPRENUDC = 'PR_PK'
WHERE UDC_ORDINE = X_ORDINE
IF @@rowcount <> 1
BEGIN
  SET @txtError = dbo.fn_td ('UDS availability is wrong !')
  GOTO lblExit
END
DECLARE @udcMadre DECIMAL(15, 0)
SELECT
   @SU       = X_SU_CODE
  ,@udcMadre = X_UDC_MADRE
FROM #tmpLu
  INNER JOIN #tbl_KittingPicking_St2 ON 1 = 1

PRINT CONCAT ('SU CODE ', @SU)
PRINT CONCAT ('UDC MADRE ', @udcMadre)

SET @pEseId = CONCAT (',', @pEseId, ',')

DECLARE @art     NVARCHAR(50)
       ,@eseqtar DECIMAL(11, 3)

SELECT
   @art     = RIG_ARTICOLO
  ,@eseqtar = sum (ESE_QTAR)
FROM RUN_ESEGUI
  INNER JOIN DAT_ORDINI_RIGHE dor ON RUN_ESEGUI.ESE_RIGA = dor.RIG_RIGA
WHERE @pEseId LIKE concat ('%,', ESE_ID, ',%')
GROUP BY RIG_ARTICOLO

DECLARE @diff INT = @eseqtar - @pQta


DECLARE @maxQte      INT
       ,@qtaToRemove INT
       ,@eseSelect   INT
IF @diff > 0
BEGIN
  WHILE EXISTS (SELECT 1 FROM RUN_ESEGUI INNER JOIN DAT_ORDINI_RIGHE dor ON RUN_ESEGUI.ESE_RIGA = dor.RIG_RIGA WHERE @pEseId LIKE concat ('%,', ESE_ID, ',%') AND ESE_QTAE > 0) AND @diff > 0
  BEGIN
    SELECT TOP 1
       @eseSelect = ESE_ID
      ,@maxQte    = ESE_QTAE
    FROM RUN_ESEGUI
      INNER JOIN DAT_ORDINI_RIGHE dor ON RUN_ESEGUI.ESE_RIGA = dor.RIG_RIGA
    WHERE @pEseId LIKE concat ('%,', ESE_ID, ',%')
          AND ESE_QTAE > 0
    ORDER BY iif (ESE_ID = @pEseShortage, 0, 1)
    --prima comincia da quella da fare scarseggiare

    IF @diff <= @maxQte
    BEGIN
      SET @qtaToRemove = @diff
    END
    ELSE
    BEGIN
      SET @qtaToRemove = @maxQte
    END
    SET @diff -= @qtaToRemove

    UPDATE RUN_ESEGUI
      SET ESE_QTAE -= @qtaToRemove
    FROM RUN_ESEGUI
    WHERE @eseSelect = ESE_ID

  END
END


SELECT ESE_ID
   ,ESE_QTAE
INTO #tmpConf
FROM RUN_ESEGUI
WHERE @pEseId LIKE concat ('%,', ESE_ID, ',%')

WHILE EXISTS (SELECT 1 FROM #tmpConf)
BEGIN
  DECLARE @qtaE INT

  SELECT TOP 1
     @eseSelect = ESE_ID
    ,@qtaE      = ESE_QTAE
  FROM #tmpConf

  DELETE
  FROM #tmpConf
  WHERE ESE_ID = @eseSelect

  EXEC @retVal             = ws_L2_EditScomparto_Conf_Esegui @pComponente = N'UOMO1'
      ,@pOperatore         = @USER
      ,@pBaia              = 0
      ,@pArticolo          = @art
      ,@pSub1              = N''
      ,@pSub2              = N''
      ,@pSco_SSCC_Source   = N''
      ,@pSco_SSCC_Comp     = N''
      ,@pDPro              = 0
      ,@pDSca              = 0
      ,@pStaMate           = N''
      ,@pTipoConf          = N''
      ,@pQta_Set           = @qtaE
      ,@pSkipCheckQta      = 0
      ,@pPmuUds            = 0
      ,@pEse_id            = @eseSelect
      ,@pExe_note          = N''
      ,@pResiduoInAltraUds = 0
END


IF @retVal < 0
  GOTO lblExit


lblExit:
IF @trancount = 0 AND @@trancount > 0
BEGIN
  IF @txtError > '' OR XACT_STATE () = - 1 OR @retVal < 0
    ROLLBACK TRANSACTION
  ELSE
    COMMIT TRANSACTION
END
IF @txtError > '' 
  RAISERROR (@txtError, 16, 1)
RETURN
  CASE
    WHEN @txtError > '' OR XACT_STATE () = - 1 OR @retVal < 0
      THEN - 1
    ELSE 0
  END