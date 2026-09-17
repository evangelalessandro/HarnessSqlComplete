/*
 Per i return in kitting area, l’operatore prima scansiona il pallet e il primo modulo prima dell’elevatore, e il pallet sale al primo piano. 
 Poi l’operatore in kitting area scansiona il pallet, riceve le indicazioni e scansiona il pallet di destinazione per confermare il deposito. 

*/
create or alter procedure [dbo].[ws_CIDEDO_HUSOBUME_KIPEVUBEGUSEV_St1_GIVOSEB]
(
                 @user nvarchar(50)
                ,@sco  decimal(15,0) = 0 --filter from ws_CIDEDO_HUSOBUME_KIPEVUBEGUSEV_St1_EAVIBAG
)
as
  set nocount on
  set xact_abort on
  declare @retVal   int
         ,@txtError nvarchar(max)

  /* Transaction */
  declare @trancount int = @@trancount
  if @trancount < 1
    begin transaction


  exec @retVal = ws_L2_LESIVEGUDUVASAP @errore = @txtError out
  if @retVal <> 0
    goto lblExit

    ;
  with tbl
  as (select top 1
          SCO_SCOMPARTO      X_SCO --sorgente
         ,UDC_UDC            X_UDC_SOURCE
         ,UDC_SSCC           X_SSCC--sorgente
         ,UDC_ARTICOLO       X_SKU
         ,ART_DES            X_SKU_DESC
         ,SCO_GIAC + SCO_VER X_GIAC

         ,UDC_USER_TASK

       from DAT_UDC
         inner join DAT_SCOMPART on SCO_UDC = UDC_UDC
         inner join DAT_ARTICOLI on SCO_ARTICOLO = ART_ARTICOLO and SCO_ARTICOLO > ''
         inner join MAG_CORRIDOI on COR_CORRIDOIO = UDC_CORRIDOIO and COR_AREA = 'AP'
         left join RUN_MISSIONI on MIS_UDC = UDC_UDC
       where (UDC_CAUSMISS = 'KREPL'
               and MIS_L2STA in ('WS','OUTHD')
               or COR_USOCORR like '%,RETKI,%')
             and (UDC_USER_TASK = ''
               or UDC_USER_TASK = @user)
             and UDC_RETURN = 1

        order by IIF(UDC_USER_TASK > '',0,1)
                ,SCO_SCOMPARTO
    )
  select top 1
     *
    ,CAST('' as nvarchar(50)) as X_SSCC_DEST
    ,0                        X_CORRIDOIO
    ,0                        X_CELLA
    ,CAST(0 as decimal(15,0)) X_UDC_DEST
  into #tmpMission
  from tbl
  where (@sco > 0
          and X_SCO = @sco
          or @sco = 0)
   order by IIF(UDC_USER_TASK = @user,0,1)
  if @@rowcount = 0
  begin
    print 'No task find'
    goto lblExit
  end

  /*se c'è la missione la cancello*/
  update RUN_MISSIONI
    set MIS_L2STA          = 'OUTHD'
       ,MIS_MODULO         = ''
       ,MIS_l1STA          = 'TE'
       ,MIS_GES_STA        = 'TE'
       ,MIS_ESMISS         = 'OK'
       ,MIS_H_MOD_SVUOTATO = 1
  from RUN_MISSIONI
    inner join #tmpMission on X_UDC_SOURCE = MIS_UDC
  where MIS_L2STA in ('OUTHD','WS')

  /*se non è già nel corridoio giusto lo metto*/
  if not exists (select
          1
       from dat_udc
         inner join #tmpMission on X_UDC_SOURCE = UDC_UDC
         inner join MAG_CORRIDOI on COR_USOCORR like '%,RETKI,%' and UDC_CORRIDOIO
           = COR_CORRIDOIO
    )
  begin
    /*lo sposto nel corridoio dei returns */
    update DAT_UDC
      set UDC_CORRIDOIO = COR_CORRIDOIO
         ,UDC_CELLA     = 0
    from dat_udc
      inner join #tmpMission on X_UDC_SOURCE = UDC_UDC
      inner join MAG_CORRIDOI on COR_USOCORR like '%,RETKI,%'
    if @@ROWCOUNT = 0
    begin
      set @txtError = 'update error in set aisle of return !'
      goto lblExit
    end
  end

  /*seleziono una udc dove ci può stare questa roba o un posto vuoto*/
  select top 1
     UDC_UDC
    ,UDC_CORRIDOIO
    ,UDC_CELLA
  into #tmpNewDest
  from #tmpMission
    inner join DAT_UDC on UDC_ARTICOLO = X_SKU
    inner join DAT_ARTICOLI on ART_ARTICOLO = UDC_ARTICOLO
    inner join DAT_SCOMPART on SCO_UDC = UDC_UDC-- and SCO_GIAC + X_giac <= ART_FULLPALLET_QTA --non deve riempirlo oltre misura
    inner join MAG_CORRIDOI on COR_CORRIDOIO = UDC_CORRIDOIO and COR_AREA = 'AP' and UDC_CELLA > 0
      and UDC_STAPRENUDC = 'D'
   order by SCO_GIAC desc
           ,SCO_DSCA

  if @@ROWCOUNT > 0
  begin
    update #tmpMission
      set X_CORRIDOIO = UDC_CORRIDOIO
         ,X_CELLA     = UDC_CELLA
         ,X_UDC_DEST  = UDC_UDC
    from #tmpNewDest
      inner join #tmpMission on 1 = 1


  end
  else begin
    -- --se non li ho trovati allora cella vuota
    -- SELECT TOP 1 CEL_CELLA
    --    ,CEL_CORRIDOIO
    -- INTO #tmpCell
    -- FROM MAG_CELLE
    --   INNER JOIN MAG_CORRIDOI ON COR_CORRIDOIO = CEL_CORRIDOIO
    -- WHERE CEL_ABI = 1
    --       AND COR_AREA = 'AP'
    --       AND COR_ABIING = 1
    --       AND CEL_CELLA > 0
    --       AND CEL_STACELLA = 'L'
    -- ORDER BY CEL_PRIO
    -- IF @@ROWCOUNT > 0
    -- BEGIN
    --   UPDATE #tmpMission
    --     SET X_CORRIDOIO = CEL_CORRIDOIO
    --         ,X_CELLA = CEL_CELLA
    --   FROM #tmpCell
    --     INNER JOIN #tmpMission ON 1 = 1
    -- END
    -- ELSE

    begin
      set @txtError = 'No Lu destination available !'
      goto lblExit
    end

  end


  if OBJECT_ID('tempdb..#tbl_ReturnKitting_St1') is not null
  begin
    insert into #tbl_ReturnKitting_St1
    (
      X_SCO
     ,X_SSCC
     ,X_SKU
     ,X_SKU_DESC
     ,X_GIAC
     ,X_CORRIDOIO
     ,X_CELLA
     ,UDC_USER_TASK
     ,X_UDC
    )
    select
       X_SCO
      ,X_SSCC
      ,X_SKU
      ,X_SKU_DESC
      ,X_GIAC
      ,X_CORRIDOIO
      ,X_CELLA
      ,UDC_USER_TASK
      ,X_UDC_SOURCE
    from #tmpMission
    print 'Inserto dato in tbl temporanea'
    goto lblExit
  end
  else print 'non esiste tbl temporanea'

  if exists (select
          1
       from #tmpMission
       where UDC_USER_TASK = ''
    )
  begin
    update DAT_UDC
      set UDC_USER_TASK = @user
    from DAT_UDC
      inner join #tmpMission on X_UDC_SOURCE = UDC_UDC
  end


  declare @idRiga int

  insert into DAT_ORDINI_RIGHE
  (
    RIG_ORDINE
   ,RIG_UDC
   ,RIG_SCOMPARTO
   ,RIG_ARTICOLO
   ,RIG_SUB1
   ,RIG_SUB2
   ,RIG_STAMATE
   ,RIG_TIPOCONF
   ,RIG_QTAR

  )
  select
     '_IMM.VERSAMENTO_'
    ,X_UDC_SOURCE
    ,X_SCO
    ,SCO_ARTICOLO
    ,''
    ,''
    ,''
    ,''
    ,1
  from #tmpMission
    inner join DAT_SCOMPART on SCO_SCOMPARTO = X_SCO
  select @idRiga = SCOPE_IDENTITY();

  /* Inserisco la missione */
  insert into RUN_ESEGUI
  (
    ESE_REQ_OPERATORE
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
   ,ESE_CORD
  )
  select
     @user
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
    ,'RETRN'
    ,X_UDC_DEST
    ,UDC_CORRIDOIO
  from #tmpMission
    inner join DAT_UDC on udc_udc = X_UDC_DEST
    inner join MAG_BAIE on BCO_USOBAIA like '%,RETRN,%'


  if @retVal < 0
    goto lblExit

  select * from #tmpMission

  lblExit:
  if @trancount = 0 and @@trancount > 0
  begin
    if @txtError > '' or XACT_STATE() = -1 or @retVal < 0
      rollback transaction
    else commit transaction
  end
  if @txtError > ''
    raiserror (@txtError,16,1)
  return
  case
       when @txtError > '' or
            XACT_STATE() = -1 or
            @retVal < 0
         then -1
       else 0
  end
