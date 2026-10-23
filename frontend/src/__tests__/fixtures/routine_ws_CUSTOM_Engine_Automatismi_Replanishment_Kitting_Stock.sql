/*

   Automated tasks management (Pallet movimentation)

   Actions
    - vna -> kitting send pallet that are in sub qta 

   Parameters
     @pComponente  Component
     @pGestore     Manager
     @pOperatore   Operator
     @pAutomatismo Automatism
     @pSimula      If 1, only simulation
     @pWups        List of process to wake-up
   
   Returns 0 if OK, otheriwse an error code

*/
CREATE   procedure [dbo].[ws_CUSTOM_Engine_Automatismi_Replanishment_Kitting_Stock]
(
                 @pComponente  nvarchar(max) = 'L2ENGINE'
                ,@pGestore     nvarchar(max) = 'GES_AUTOMATISMI'
                ,@pOperatore   nvarchar(max) = 'SYSTEM'
                ,@pAutomatismo nvarchar(max) = 'REPKT'
                ,@pSimula      bit           = 0
                ,@pWups        nvarchar(max) = null output
                ,@pMsg         nvarchar(max) = null output
)
as
  set nocount on
  set xact_abort on


  /* Declarations */
  declare @retVal     int
         ,@txtError   nvarchar(max)
         ,@diaMsg     nvarchar(max)
         ,@transcount int
  /* Initializations */
  select
     @transcount = @@trancount
    ,@pWups      = ','


  exec @retVal = ws_L2_LockRunAnn @errore = @txtError output
  if @retVal <> 0
    goto lblExit

  declare @totAvailSpace int
  select
     @totAvailSpace = COUNT(*)
  from MAG_CELLE
    inner join MAG_CORRIDOI on CEL_CORRIDOIO = COR_CORRIDOIO
  where CEL_CELLA > 0
        and COR_AREA = 'AP'
        and CEL_STACELLA = 'L'
        and CEL_ABI = 1
        and COR_ABIING = 1


  select
     @totAvailSpace -= IIF(WOR_NUM > 0,WOR_NUM,0)
  from UTI_WORK
  where WOR_COD = 'KITTING_EMPTY'


  print CONCAT('totAvailSpace ',@totAvailSpace)
  if @totAvailSpace <= 0
  begin
    select
       @diaMsg = dbo.fn_InsTextStr('No space available from replanishment in kitting area',default,default,default,default,default)
    print @diaMsg

    goto lblExit
  end
  /*check target*/

  select
     ART_ARTICOLO           X_ART
    ,ART_KITTING_TARGET     X_TARGET
    ,ART_KITTING_TARGET_MIN X_TARGET_MIN
  into #tmpSku
  from DAT_ARTICOLI
  where ART_KITTING_TARGET_MIN > 0
        or ART_KITTING_TARGET > 0

  update #tmpSku
    set X_TARGET = X_TARGET_MIN
  where X_TARGET = 0


  select
     SUM(SCO_GIAC - SCO_PRE + SCO_VER) X_QTA
    ,SCO_ARTICOLO                      X_SKU
  into #tmpGiac
  from DAT_UDC
    inner join DAT_SCOMPART ds on DAT_UDC.UDC_UDC = ds.SCO_UDC
    inner join MAG_CORRIDOI on DAT_UDC.UDC_D_CORRIDOIO = MAG_CORRIDOI.COR_CORRIDOIO
      and COR_AREA = 'AP' and UDC_CELLA > 0
      and UDC_ORDINE=''
  group by SCO_ARTICOLO



  /*remove already to target*/

  select
     UDC_ARTICOLO  M_ART
    ,SUM(UDC_GIAC) M_GIAC
  into #tmpMiss
  from RUN_MISSIONI
    inner join DAT_UDC on UDC_UDC = MIS_UDC
  where MIS_CAUSMISS = 'KREPL'
  group by UDC_ARTICOLO

  /*remove from target mission*/
  update a
    set a.X_TARGET     -= m.M_GIAC
       ,a.X_TARGET_MIN -= m.M_GIAC
  from #tmpSku a
    inner join #tmpMiss m on m.M_ART = a.X_ART


  delete a
  from #tmpSku a inner join #tmpGiac b on
           a.X_ART = b.X_SKU
           and
           b.X_QTA > X_TARGET



  select
     a.X_ART
    ,a.X_TARGET - ISNULL(b.X_QTA ,0)    X_TARGET
    ,a.X_TARGET_MIN - ISNULL(b.X_QTA ,0) X_TARGET_MIN
  into #tmpResume
  from #tmpSku a
    left join #tmpGiac b on a.X_ART = b.X_SKU

  declare @v xml
  set @v = (select
        *
     from #tmpResume for json path
  )
  print CONCAT('Sku request ',REPLACE(CAST(@v as nvarchar(max)),'},{',CHAR(13)))

  if not exists (select
          1
       from #tmpSku
    )
  begin
    select
       @diaMsg = dbo.fn_InsTextStr('No need replanishment on kitting',default,default,default,default,default)
    print @diaMsg
    goto lblExit
  end 
  select distinct
     ROW_NUMBER() over (order by UDC_UDC) as X_ID
    ,X_PROCESSED =                        0
    ,X_TYPE =                             'BAY_REFILLING'
    ,X_DST_BAY =                          BCO_BAIA
    ,X_ARTICLE =                          SCO_ARTICOLO
    ,X_PRIORITY =                         90 
    ,X_MISSCAUSAL =                       'KREPL'
    ,X_HOSTCAUSAL =                       ''
    ,X_UDC =                              UDC_UDC
     /**/
    ,X_MSGKO =                            case
                   when BCO_ABI = 0
                     then 'Bay disabled'
                   --when BCO_TIPOSCHED = 'M'
                   --  then 'Bay in Manual Schedulation'
                   when UDC_STADISPUDC <> 'D' or
                        not UDC_UBIUDC in ('M','I')
                     then '#10.' + dbo.fn_td('LU not available')
                   when UDC_CELLA = 0
                     then '#12.' + dbo.fn_td('LU not available')
                   

                   when not (
                        UDC_UBIUDC = 'I' or
                        (CEL_CELLA > 0 and
                        CEL_STACELLA in ('O','L','IP','IV') and
                        CEL_ABI = 1 and
                        CEL_INIBITA = 0) or
                        (CEL_CELLA = 0 and
                        COR_TIPOCORR = 'N' and
                        COR_GEST_LGV_USER = 0)

                        ) or
                        COR_GEST_LGV_USER = 1
                     then '#23.' + dbo.fn_td('Stato cella o ubicazione non valida per l''operazione')

                   when UDC_NESE > 0 or
                        UDC_CAUSMISS > ''
                     then '#25.' + dbo.fn_td('LU occupy')

                   when UDC_STAPRENUDC <> 'D' or
                        UDC_ORDINE <> ''
                     then '#26.' + dbo.fn_td('UDS')
                   when BCO_TOT_ESE_OUT_CALC >= BCO_CAPOUT or
                        fcm.BCO_TOT_MISS_OUT_CALC >= BCO_CAPOUT
                     then '#99.' + dbo.fn_td('Capacita'' massima raggiunta')
                   --when exists(select 1 from RUN_ESEGUI inner join DAT_UDC du on RUN_ESEGUI.ESE_UDC = du.UDC_UDC
                   --     and COR_CORRIDOIO=UDC_CORRIDOIO and ESE_BAIA=BCO_BAIA 
                   --   LEFT join RUN_MISSIONI rm on du.UDC_UDC = rm.MIS_UDC 
                   --   where rm.MIS_MISSIONE is null)
                   -- then '#27.' + dbo.fn_td('Exists already mission from the same aisle')
                   else '' /* Scomparto ancora candidato */
              end
    ,X_NOTE =                             'refilling'
    ,X_PALLETMANCANTI =                   X_TARGET_MIN/(ART_FULLPALLET_QTA * 1.00) 
    ,X_GIAC =                             SCO_GIAC
    ,X_MAXPrio = IIF(ISNULL(b.X_QTA,0)=0,1,0)
  --,X_TARGET_MIN
  --,X_TARGET
  into #TMP_ACTIONS
  from MAG_BAIE
    inner join DAT_UDC on BCO_SKU = '' and BCO_USOBAIA like '%,KITPK,%'  --solo baie che hanno il tipo articolo vuoto
    inner join DAT_SCOMPART on SCO_UDC = UDC_UDC /*and SCO_STAMATE='U'*/  
    inner join DAT_ARTICOLI on ART_ARTICOLO = SCO_ARTICOLO
    inner join MAG_CORRIDOI on (COR_CORRIDOIO = UDC_CORRIDOIO) and COR_TIPOCORR = 'M' and COR_AREA = 'AM'
    inner join MAG_CELLE with (index (PK_MAG_CELLE)) on CEL_CORRIDOIO = UDC_CORRIDOIO and CEL_CELLA = UDC_CELLA
    inner join #tmpResume a on a.X_ART = SCO_ARTICOLO
    left join #tmpGiac b on b.X_SKU=X_ART
    left join dbo.fn_Calc_BCO_TOT_ESE_OUT() fcbteo on BCO_BAIA_CALC = BCO_BAIA
    left join dbo.fn_Calc_BCO_TOT_MISS_OUT() fcm on fcm.BCO_BAIA_CALC = BCO_BAIA

  where UDC_UDC > 0

    
  /* debug */
  if @pSimula = 1
    select * from #TMP_ACTIONS

  if exists (select
          1
       from #TMP_ACTIONS
       where X_MSGKO like '%#99%'
    ) and not exists (select
          1
       from #TMP_ACTIONS
       where X_MSGKO = ''
    )
  begin
    select
       @diaMsg = dbo.fn_InsTextStr('launch dbo.ws_CUSTOM_Engine_Automatismi_Replanishment_Kitting_Stock @pSimula=1 for debug, capacita'' massima raggiunta',default,default,default,default,default)
    print @diaMsg
    goto lblexit
  end

  if (select
          COUNT(*)
       from #TMP_ACTIONS
       where X_MSGKO = ''
    ) = 0
  begin
    /* Logs */
    print @diaMsg
    goto lblexit
  end

  /* No actions -> Exit */
  update #TMP_ACTIONS
    set X_PROCESSED = 1
  where X_MSGKO > '' or
        @pSimula = 1
  if (select
          COUNT(*)
       from #TMP_ACTIONS
       where X_PROCESSED = 0
    ) = 0
    goto lblExit



  /* Do Actions */
  declare @x_id          int
         ,@x_type        nvarchar(max)
         ,@x_article     nvarchar(max)
         ,@x_article_new nvarchar(max)
         ,@x_udcpred     nvarchar(max)
         ,@x_udc         decimal(15)
         ,@x_elebuffers  nvarchar(max)
         ,@x_note        nvarchar(max)
         ,@x_misscausal  nvarchar(max)
         ,@x_hostcausal  nvarchar(max)
         ,@x_executed_ok bit
         ,@X_DST_BAY     int
         ,@X_QTY         int

  while 1 = 1
  begin
    select
       @x_note        = ''
      ,@x_executed_ok = 0
      ,@x_udc         = null


    /* Get an action to process */
    select top 1
       @x_id         = X_ID
      ,@x_type       = X_TYPE
      ,@x_article    = X_ARTICLE
      ,@x_udc        = X_UDC
      ,@x_misscausal = X_MISSCAUSAL
      ,@x_hostcausal = X_HOSTCAUSAL
      ,@X_DST_BAY    = X_DST_BAY-- 999

      ,@X_QTY        = X_GIAC
    --,@x_note=X_NOTE
    from #TMP_ACTIONS
      inner join DAT_UDC on UDC_UDC = X_UDC
      left join dbo.fn_Calc_BCO_TOT_MISS_OUT() fcbteo on BCO_BAIA_CALC = X_DST_BAY
    where X_PROCESSED = 0
          and X_MSGKO = ''
          and X_PALLETMANCANTI > 0
     order by X_MAXPrio desc, X_PALLETMANCANTI desc
             ,BCO_TOT_MISS_OUT_CALC



    if @@rowcount <> 1
    begin
      print 'Not found row'
      break
    end

    if @x_type = 'BAY_REFILLING' and @x_udc is not null
    begin
      print @x_udc
      declare @d datetime
      set @d = GETDATE()
       

       
      INSERT INTO DAT_ORDINI_RIGHE (RIG_ORDINE, RIG_PRIO, RIG_UDC, RIG_SCOMPARTO,
                              RIG_ARTICOLO, RIG_SUB1, RIG_SUB2, RIG_SSCC_SOURCE, RIG_STAMATE, RIG_TIPOCONF, RIG_QTAR,
                              RIG_REQ_NOTE, RIG_HOSTCAUS, RIG_HOSTRIF,
                              RIG_ONLY_TO_INVENT, RIG_ONLY_COMPLETI
                             )
                             select 
                             '_IMM.PRELIEVO_', 0, UDC_UDC, 0,
                              '', '', '', '', '', '', 1,
                              '', '', '',
                              0, 0
                             from DAT_UDC 
                             where UDC_UDC=@x_udc

                             declare @riga int
    set @riga = scope_identity()


      insert into RUN_ESEGUI
      (
        ESE_TIME
       ,ESE_REQ_OPERATORE
       ,ESE_EXE_OPERATORE
       ,ESE_QTAR
       ,ESE_QTAE
       ,ESE_CONFERMA
       ,ESE_RIGA
       ,ESE_SCOMPARTO
       ,ESE_UDC
       ,ESE_BAIA
       ,ESE_RICTIPO
       ,ESE_BPRIO
       ,ESE_PRIO
       ,ESE_CAUSMISS
       ,ESE_COMPONENTE
       ,ESE_CORD
      )
      select
         GETDATE()
        ,'SYSTEM'
        ,'SYSTEM'
        ,1
        ,1
        ,0
        ,@riga
        ,0
        ,UDC_UDC
        ,@X_DST_BAY

        ,'I'
        ,0
        ,0
        ,@x_misscausal
        ,@pComponente
        ,100
      from dat_udc
      where UDC_UDC=@x_udc




      update #TMP_ACTIONS
        set X_MSGKO     = @x_note
           ,X_PROCESSED = 1
      where X_UDC = @x_udc

      update #TMP_ACTIONS
        set X_PALLETMANCANTI -= 1
      where X_ARTICLE = @x_article


      /* Logs */
      select
         @diaMsg = dbo.fn_InsTextStr('Send of LU {0} to bay {1} with causal {2}',@x_udc,@x_dst_bay,@x_misscausal,default,default)
      exec @retval = ws_LOG_AddLogWork @type      = 'EV'
                                      ,@msg       = @diaMsg
                                      ,@masComGes = 'L2ENGINE'
                                      ,@operatore = 'SYSTEM'
                                      ,@livello   = 3
      if @retval < 0
        goto lblexit
      print @diaMsg
      print @x_note

      /* Task Executed (if @x_note = '') */
      set @x_executed_ok = case
                               when @x_note = ''
                                 then 1
                               else 0
                          end
      goto lblContinue
    end

    /* Next action */
    lblContinue:

    /* Transaction */
    if @transcount = 0 and @@trancount > 0
    begin
      if @x_executed_ok = 0 or @txtError > '' or XACT_STATE() = -1
        rollback transaction
      else commit transaction
    end

    /* Update task process */
    update #TMP_ACTIONS
      set X_PROCESSED = 1
         ,X_MSGKO     = case
                            when @x_executed_ok = 1
                              then 'Executed'
                            else X_MSGKO
                       end
    where X_UDC = @x_udc
  --if @x_executed_ok = 1
  --begin
  --  update #TMP_ACTIONS
  --  set X_PROCESSED = 1
  --     ,X_MSGKO     = 'Ignored'
  --  where X_PROCESSED = 0 and X_TYPE = @x_type
  --end
  end



  /* */
  lblExit:
  if @transcount = 0 and @@trancount > 0
  begin
    if @txtError > '' or XACT_STATE() = -1
      rollback transaction
    else commit transaction
  end

  if @txtError > ''
    raiserror (@txtError,16,1)



  return case
       when @txtError > ''
         then -1
       else 0
  end
