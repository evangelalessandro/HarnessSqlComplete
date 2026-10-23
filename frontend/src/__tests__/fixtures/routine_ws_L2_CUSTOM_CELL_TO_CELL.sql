CREATE OR ALTER procedure [dbo].[ws_L2_CUSTOM_CELL_TO_CELL]
(
                 @pUdc       decimal(15,0)
                ,@pUSER      nvarchar(50)
                ,@pCellDest  nvarchar(50)
                ,@pOperation nvarchar(50)--'KIT','vna','ForceVNA'
)
as
  set nocount on
  set xact_abort on
  declare @retVal   int
         ,@txtError nvarchar(max)
         ,@dCell    int
         ,@dCorr    int
         ,@causmiss NVARCHAR(50)
         ,@usoBay NVARCHAR(50)
  /* Transaction */
  declare @trancount int = @@trancount
  if @trancount < 1
    begin transaction

  select
     @txtError = case
                     when UDC_CAUSMISS <> ''
                       then 'LU already used'
                    when      @pOperation in( 'KIT' ,'VNA','ForceVNA')
                        then 'Operation not valid '
                     when @pOperation = 'KIT' and
                          COR_AREA <> 'AP'
                       then 'LU not in kitting area '
                      when @pOperation = 'VNA' and
                          COR_AREA <> 'AM'
                       then 'LU not in VNA area '
                     else ''
                end

  from (select 1 X_CE) T
    left join DAT_UDC on udc_udc = @pUdc
    inner join MAG_CORRIDOI on COR_CORRIDOIO = udc_corridoio


  select
     @dCorr = PARSENAME(REPLACE(@pCellDest,'-','.'),2)
    ,@dCell = PARSENAME(REPLACE(@pCellDest,'-','.'),1)
    ,@usoBay=case when (@pOperation = 'KIT') then ',CCKIT,'
              when (@pOperation = 'vna') then ',CCVNA,'
            else ''end
    ,@causmiss= case when (@pOperation = 'KIT') then 'CCKIT'
                      when (@pOperation = 'vna') then 'CCVNA'
                                else ''end

  if @pOperation in ('KIT','vna')
  begin
 

    /* Inserisco la missione */
    insert into RUN_MISSIONI
    (
      MIS_UDC
     ,MIS_OPERATORE
     ,MIS_S_BAIA
     ,MIS_S_PIAZZOLA
     ,MIS_S_CORRIDOIO
     ,MIS_S_CELLA
     ,MIS_S_POS
     ,MIS_S_DEP
     ,MIS_D_BAIA
     ,MIS_D_PIAZZOLA
     ,MIS_FIN_BAIA
     ,MIS_D_CORRIDOIO
     ,MIS_D_CELLA
     ,MIS_L2STA
     ,MIS_CAUSMISS
     ,MIS_L1_GESTORE
     ,MIS_L1STA
     ,MIS_ERRMISS
     ,MIS_COMPONENTE
     ,MIS_MODULO
    )
    select
       @pUdc
      ,@pUser
      ,BCO_BAIA
      ,0
      ,0
      ,0
      ,1
      ,1
      ,0
      ,0
      ,0
      ,@dCorr
      ,@dCell
      ,'WL'
      , @causmiss
      ,'LIVELLO1'
      ,'PR'
      ,''
      ,'UOMO'
      ,''

    from MAG_BAIE
    where BCO_USOBAIA like concat('%',@usoBay,'%')

    if @@ROWCOUNT = 1
      print 'Missione creata'

    else begin
       set @txtError = 'Errori nella generazione missione'
       goto lblExit
      end
  end
  else begin
       set @txtError = 'Caso non gestito'
  end

  /* Whenever a SP a called always checks the result value:
      A negative return value usually stands for a critical error
   If the called SP raises an error through the 'raiserror' statement is not necessary invoke the raiserror is this contest (thus, this kind of behavior is highly discouraged) 
   */
  -- exec @retval = ws_CUSTOM_OtherStoredProcedureName ... Parameters
  if @retVal < 0
    goto lblExit

  lblExit:
  if @trancount = 0 and @@trancount > 0
  begin
    if @txtError > '' or XACT_STATE() = -1 or @retVal < 0
      rollback transaction
    else commit transaction
  end
  if @txtError > ''
    raiserror (@txtError,16,1)
  return case
       when @txtError > '' or
            XACT_STATE() = -1 or
            @retVal < 0
         then -1
       else 0
  end
