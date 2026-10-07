/*
 
*/
CREATE OR ALTER PROCEDURE [dbo].[ws_CUSTOM_Handheld_Kitting_Bay_To_Rack_St1_GetList]
(
        @user  NVARCHAR(50)
        ,@pUDC DECIMAL(15, 0) = 0
)
AS
SET NOCOUNT ON
SET XACT_ABORT ON
DECLARE @retVal   INT
       ,@txtError NVARCHAR(max)

/* Transaction */
DECLARE @trancount INT = @@trancount
       ,@causmiss  NVARCHAR(50)

IF @trancount < 1
BEGIN TRANSACTION


EXEC @retVal = ws_L2_LockRunHandHeld @errore = @txtError out
IF @retVal <> 0
  GOTO lblExit


SELECT UDC_UDC X_UDC
   ,UDC_TAG
INTO #tmp
FROM DAT_UDC
  INNER JOIN DAT_SCOMPART ON SCO_UDC = UDC_UDC
  INNER JOIN MAG_CORRIDOI ON COR_CORRIDOIO = UDC_CORRIDOIO
  INNER JOIN RUN_MISSIONI ON MIS_UDC = UDC_UDC
  INNER JOIN TIPI_CAUSALI_MISSIONI ON MIS_CAUSMISS = CAUM_CAUSMISS
  INNER JOIN MAG_BAIE ON BCO_BAIA = MIS_FIN_BAIA AND BCO_USOBAIA LIKE '%,KITPK,%'
WHERE MIS_L2STA IN ('WS', 'OUTHD', 'WO')
      AND MIS_CAUSMISS = 'KREPL'
      AND UDC_TAG = ''

UPDATE DAT_UDC
  SET UDC_TAG = 'KREPL'
FROM #tmp
  INNER JOIN DAT_UDC ON UDC_UDC = X_UDC


SELECT TOP 1 SCO_SCOMPARTO X_SCO --sorgente
, UDC_UDC X_UDC_SOURCE, IIF (UDC_SSCC > '', UDC_SSCC, SCO_SSCC_SOURCE) X_SSCC --sorgente
, UDC_ARTICOLO X_SKU, ART_DES X_SKU_DESC, SCO_GIAC X_QTY, UDC_USER_TASK, MIS_CAUSMISS X_CAUSMISS, UDC_TAG X_TAG INTO #tmpAcc
  FROM DAT_UDC
  INNER JOIN DAT_SCOMPART ON SCO_UDC = UDC_UDC
  INNER JOIN DAT_ARTICOLI ON SCO_ARTICOLO = ART_ARTICOLO AND SCO_ARTICOLO > ''
  INNER JOIN MAG_CORRIDOI ON COR_CORRIDOIO = UDC_CORRIDOIO
  LEFT JOIN RUN_MISSIONI ON MIS_UDC = UDC_UDC
  LEFT JOIN TIPI_CAUSALI_MISSIONI ON MIS_CAUSMISS = CAUM_CAUSMISS
  WHERE (MIS_L2STA IS NULL AND COR_AREA = 'AP' OR MIS_L2STA IN ('WS', 'OUTHD', 'WO') AND CAUM_VNA_TO_KITTING = 1) AND (UDC_USER_TASK = '' OR UDC_USER_TASK = @user) AND UDC_RETURN = 0 AND (UDC_TAG LIKE '%,TRANS,%' OR UDC_TAG LIKE '%KREPL%')
  ORDER BY IIF (UDC_USER_TASK > '', 0, 1), SCO_SCOMPARTO

SELECT TOP 1 a.*
   ,CAST ('' AS NVARCHAR(50)) AS X_SSCC_DEST
   ,ISNULL (UDC_CORRIDOIO, 0) X_CORRIDOIO
   ,ISNULL (udc_cella, 0) X_CELLA
   ,ISNULL (UDC_UDC, CAST (0 AS DECIMAL(15, 0))) X_UDC_DEST
INTO #tmpMission
FROM #tmpAcc a
  LEFT JOIN RUN_ESEGUI ON ESE_UDC = X_UDC_SOURCE
  LEFT JOIN dat_udc ON UDC_UDC = ESE_UDC_DEST
WHERE (@pUDC > 0
        AND X_UDC_SOURCE = @pUDC
        OR @pUDC = 0)
ORDER BY IIF (a.UDC_USER_TASK = @user, 0, 1)
IF @@rowcount = 0
BEGIN
  PRINT 'No task find'
  GOTO lblExit
END
SELECT @causmiss = IIF (ISNULL (X_TAG, '') LIKE '%KREPL%', 'KREPL', 'TRAVN')
FROM #tmpMission



IF EXISTS (
  SELECT 1
  FROM RUN_ESEGUI
    INNER JOIN #tmpMission ON X_UDC_SOURCE = ESE_UDC AND ESE_UDC_DEST = 0
)
BEGIN
  PRINT 'cancella riga esegui senza destinazione '
  DELETE RUN_ESEGUI
  FROM RUN_ESEGUI
    INNER JOIN #tmpMission ON X_UDC_SOURCE = ESE_UDC
END

/*se non è già nel corridoio giusto lo metto*/
IF NOT EXISTS (
  SELECT 1
  FROM dat_udc
    INNER JOIN #tmpMission ON X_UDC_SOURCE = UDC_UDC
    INNER JOIN MAG_CORRIDOI ON COR_USOCORR LIKE '%,RETKI,%' AND UDC_CORRIDOIO = COR_CORRIDOIO
)
BEGIN
  /*lo sposto nel corridoio dei returns */
  UPDATE DAT_UDC
    SET UDC_CORRIDOIO = COR_CORRIDOIO
        ,UDC_CELLA = 0
  FROM dat_udc
    INNER JOIN #tmpMission ON X_UDC_SOURCE = UDC_UDC
    INNER JOIN MAG_CORRIDOI ON COR_USOCORR LIKE '%,RETKI,%'
  IF @@ROWCOUNT = 0
  BEGIN
    SET @txtError = 'update error in set aisle of return !'
    GOTO lblExit
  END
END
-- END -- ELSE
-- BEGIN
--   PRINT 'No mission'
-- END


/*check exists esegui per sco*/
PRINT 'exists destination udc ?'
IF NOT EXISTS (
  SELECT 1
  FROM RUN_ESEGUI
    INNER JOIN #tmpMission ON X_UDC_SOURCE = ESE_UDC
  WHERE ESE_UDC_DEST > 0
)
BEGIN
  PRINT 'check exists exec ' + @causmiss
  DECLARE @idRiga INT
  IF NOT EXISTS (
    SELECT 1
    FROM RUN_ESEGUI
      INNER JOIN #tmpMission ON ESE_SCOMPARTO = X_SCO
    WHERE ESE_CAUSMISS = @causmiss
  )
  BEGIN

    PRINT 'cerca vuoto'
    --se non li ho trovati allora cella vuota
    SELECT TOP 1 CEL_CELLA
       ,CEL_CORRIDOIO
    INTO #tmpCell
    FROM MAG_CELLE
      INNER JOIN MAG_CORRIDOI ON COR_CORRIDOIO = CEL_CORRIDOIO
    WHERE CEL_ABI = 1
          AND COR_AREA = 'AP'
          AND COR_ABIING = 1
          AND CEL_CELLA > 0
          AND CEL_STACELLA = 'L'
          AND CEL_CELLA > 0
    ORDER BY CEL_PRIO
    IF @@ROWCOUNT > 0
    BEGIN
      UPDATE #tmpMission
        SET X_CORRIDOIO = CEL_CORRIDOIO
            ,X_CELLA = CEL_CELLA
      FROM #tmpCell
        INNER JOIN #tmpMission ON 1 = 1


      DECLARE @newLu DECIMAL(15, 0) = 0
             ,@corr  INT
             ,@cell  INT

      SELECT
         @corr = X_CORRIDOIO
        ,@cell = X_CELLA
      FROM #tmpMission

      EXEC @retVal          = ws_L2_UdcCreate @udc = @newLu OUTPUT
          ,@udcPred         = N'SP'
          ,@corridoio       = @corr
          ,@cella           = @cell
          ,@pos             = 1
          ,@dep             = 1
          ,@lev             = 1
          ,@ordine          = N''
          ,@fInsScomparti   = 0
          ,@errore          = @txtError OUTPUT
          ,@sSSCC           = N''
          ,@nNumUdcToCreate = 1
      IF @retVal <> 0 OR @txtError > ''
      BEGIN
        GOTO lblExit
      END

      UPDATE #tmpMission
        SET X_UDC_DEST = @newLu

    END
    ELSE
    BEGIN
      SET @txtError = 'No Lu destination available !'
      GOTO lblExit
    END



    IF EXISTS (
      SELECT 1
      FROM #tmpMission
      WHERE UDC_USER_TASK = ''
    )
    BEGIN
      UPDATE DAT_UDC
        SET UDC_USER_TASK = @user
      FROM DAT_UDC
        INNER JOIN #tmpMission ON X_UDC_SOURCE = UDC_UDC
    END


    PRINT 'ins rig vers'
    /*genera rig versamento*/
    INSERT INTO DAT_ORDINI_RIGHE (RIG_ORDINE
                                  ,RIG_UDC
                                  ,RIG_SCOMPARTO
                                  ,RIG_ARTICOLO
                                  ,RIG_SUB1
                                  ,RIG_SUB2
                                  ,RIG_STAMATE
                                  ,RIG_TIPOCONF
                                  ,RIG_QTAR)
    SELECT '_IMM.VERSAMENTO_'
       ,X_UDC_SOURCE
       ,X_SCO
       ,SCO_ARTICOLO
       ,''
       ,''
       ,''
       ,''
       ,1
    FROM #tmpMission
      INNER JOIN DAT_SCOMPART ON SCO_SCOMPARTO = X_SCO
    SELECT @idRiga = SCOPE_IDENTITY ();
    PRINT @causmiss
    /* Inserisco la missione */
    INSERT INTO RUN_ESEGUI (ESE_REQ_OPERATORE
                            ,ESE_EXE_OPERATORE
                            ,ESE_QTAR
                            ,ESE_RIGA
                            ,ESE_SCOMPARTO
                            ,ESE_UDC
                            ,ESE_BAIA
                            ,ESE_RICTIPO
                            ,ESE_BPRIO
                            ,ESE_PRIO
                            ,ESE_EXE_NOTE
                            ,ESE_COMPONENTE
                            ,ESE_CAUSMISS
                            ,ESE_UDC_DEST
                            ,ESE_CORD)
    SELECT @user
       ,@user
       ,1 X_UDC_SOURCE
       ,@idRiga
       ,X_SCO
       ,X_UDC_SOURCE
       ,BCO_BAIA
       ,'I'
       ,1
       ,1
       ,''
       ,'UOMO'
       ,@causmiss
       ,X_UDC_DEST
       ,UDC_CORRIDOIO
    FROM #tmpMission
      INNER JOIN DAT_UDC ON udc_udc = X_UDC_DEST
      INNER JOIN MAG_BAIE ON BCO_USOBAIA LIKE '%,RETRN,%'
    IF @@rowcount <> 1
    BEGIN
      SET @txtError = 'Error in insert row exec '

      GOTO lblExit
    END

    IF @retVal < 0
      GOTO lblExit
  END
END

IF OBJECT_ID ('tempdb..#tbl_TransKitting_St1') IS NOT NULL
BEGIN
  INSERT INTO #tbl_TransKitting_St1 (X_SCO
                                     ,X_UDC_DEST
                                     ,X_UDC_SOURCE)
  SELECT X_SCO
     ,X_UDC_DEST
     ,X_UDC_SOURCE
  FROM #tmpMission
  PRINT 'Inserto dato in tbl temporanea'
  GOTO lblExit
END
ELSE
  PRINT 'non esiste tbl temporanea'


SELECT *
   ,X_UDC_SOURCE X_UDC
FROM #tmpMission

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
