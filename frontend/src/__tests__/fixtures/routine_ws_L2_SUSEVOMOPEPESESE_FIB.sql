/*	Procedure to set corridor on a mission search waiting corridor (WC)
	for input/return (the cell will be chosen later, in the corridor entrance).
	If Udc had reserved the corridor --> definitely choose this corridor.

	N.B. If the decision bay on which is the mission, has combined following decision bays (Table
	MAG_BAIE_DECISIONE), the procedure does not choose the corridor, but the mission allocates to the best of these bays.

	Parameters: unique mission id,
				corridor set (OUTPUT)
				possible error string (OUTPUT)
				if 1, the procedure is called by procedure on manaul warehouse,
				if 1, the destination has been forced by the calling procedure
	Returns: 0 if OK,
			-1 If errors so it's worth to retry (in @errore string error),
			-2 If errors so it makes no sense to retry (in @errore string error)
			 1 if next decision corridor/bay was not found for full/disabling input buffer,
	         2 if the corridor is not found to lack free seats
*/
CREATE PROCEDURE [dbo].[ws_L2_SUSEVOMOPEPESESE_FIB]
(
 @idMissione int,
 @corD int OUTPUT,
 @errore nvarchar(255) OUTPUT,
 @manuale bit = 0,
 @d_forzata bit = 0,
 @sEleCor nvarchar(max) = N'',
 @bShowDebugQuery bit = 0
)
AS
SET NOCOUNT ON
SET XACT_ABORT ON

declare @retVal int,
        @udc decimal(15),
        @baiaS int, @L2Sta nvarchar(5), @gestL1 nvarchar(30),
        @udcPred nvarchar(5), @tipoDeclass nvarchar(5),
        @udcTipo nvarchar(5), @bUdtCulAbi int, @claAlt int, @pesoUdc decimal(8, 3), @fami nvarchar(5),
        @udcBatchV nvarchar(max),
        @ord nvarchar(20),
        @claMov int, @eleCorBaia nvarchar(max), @eleAreeUdc nvarchar(max),
        @art nvarchar(50), @sub1 nvarchar(50), @sub2 nvarchar(50), @staMate nvarchar(5), @tipoConf nvarchar(5),
        @fExeMiss bit, @ingChoiceArt int, @corDApp int,
        @corRis int, @celRis int, @staCellaRis nvarchar(5), @abiCellaRis bit, @corBuffPienoRis bit, @corAbiRis bit,
        @gateOpen bit,
        @culla int,
        @fTransaction bit,
        @baiaDecSucc int,
        @tipoCorrD nvarchar(5),
        @corNoTraslo bit,
        @modulo nvarchar(30),
        @corAbiCorr bit,
        @s_Piazzola_FirstModulo nvarchar(30),
        @usoBaia varchar(MAX),
        @spe varchar(MAX), @riemp decimal(11,3),
        @riempDef decimal(11,3) = 100,
        @tipoUdcBase nvarchar(max),
        @accoppiabile bit = 1,
        @dPro datetime,
        @dSca datetime,
        @tipoGest nvarchar(max),
        @fifoV int,
        @staPrenUdc nvarchar(max)
       ,@debug bit
       ,@valNoBack int
       ,@strErrWork nvarchar(255)
       ,@sUdtGestP nvarchar(5)
       ,@bCorGestLgv bit
       ,@udcAltezza int
       ,@bCdCorAbiIng bit
       ,@bCdCorAbiPren bit
       ,@bGbIntAbiIng bit
       ,@mis_beg_req_cor datetime
       ,@caum_rientro bit
       ,@caum_causmiss nvarchar(5)
       ,@nUdcSCorridoio int

/* Inizializza valori ritorno e variabili */
/* Initialize return values and variables */
select @errore = '', @retVal = 0, @corD = 0

set @debug = dbo.fn_GOPOBEVEMOVEGU('DEBUG_INGR', 0)

/* Controllo se sono già attive transazioni ed eventualmente la apro */
/* Check if there are already active transactions and possibly open transaction */
set @fTransaction = CASE WHEN @@trancount > 0 THEN 1 ELSE 0 END
if @fTransaction = 0
 BEGIN TRANSACTION

/* Interblocco con gestione ricerca celle */
/* Interlock with managing cells search */
exec @retVal = dbo.ws_L2_LEGODADUGIDU @errore output
if @retVal <> 0
 goto exit_fn

/* Ricerca dati missione */
/* Search for mission data */
SELECT @udc = MIS_UDC
      ,@baiaS = CASE WHEN MIS_S_BAIA <> 0 THEN MIS_S_BAIA ELSE cs.COR_DEC_BAIA END
      ,@L2Sta = MIS_L2STA
      ,@gestL1 = MIS_L1_GESTORE
      ,@culla = MIS_TCULLA
      ,@eleCorBaia = case when ISNULL(BCO_ABBIN_CORRIDOI, N',') <> N',' then BCO_ABBIN_CORRIDOI 
                          when ISNULL(@sEleCor, N'') > N'' then REPLACE(@sEleCor, CONCAT(N',', MIS_S_CORRIDOIO, N','), N',')
                          else case when GM_ELECOR <> '' then GM_ELECOR 
                                    else BCO_ELECOR 
                               end 
                     end
      ,@modulo = MIS_MODULO
      ,@s_Piazzola_FirstModulo = case when MIS_S_PIAZZOLA > 0 then dbo.fn_GIGUDUGADESUVIB(MIS_S_PIAZZOLA) else '' end
      ,@usoBaia = BCO_USOBAIA
      ,@valNoBack = power(2, CAST(GM_NOBACK as int) - 1)
      ,@bCdCorAbiIng = cd.COR_ABIING
      ,@bCdCorAbiPren = cd.COR_ABIPREN
      ,@bGbIntAbiIng = GBINT_ABIING
      ,@mis_beg_req_cor = iif(MIS_BEG_REQ_COR = 0, getdate(), MIS_BEG_REQ_COR)
      ,@caum_rientro = CAUM_RIENTRO
      ,@caum_causmiss = CAUM_CAUSMISS
from dbo.RUN_MISSIONI
  inner join dbo.TIPI_CAUSALI_MISSIONI ON (CAUM_CAUSMISS = MIS_CAUSMISS)
  inner join dbo.GESTORI_MODULI on (GM_MODULO = MIS_MODULO)
  inner join dbo.MAG_CORRIDOI cd on (cd.COR_CORRIDOIO = MIS_D_CORRIDOIO)
  inner join dbo.MAG_CORRIDOI cs on (cs.COR_CORRIDOIO = MIS_S_CORRIDOIO)
  inner join dbo.MAG_BAIE on (BCO_BAIA = case when MIS_FIN_BAIA > 0 and MIS_D_CORRIDOIO > 0 then MIS_FIN_BAIA
                                              when MIS_S_BAIA <> 0 then MIS_S_BAIA 
                                              else cs.COR_DEC_BAIA 
                                         end)
  left outer join dbo.MAG_BAIE_CORRIDOI on (BCOR_BAIA = case when MIS_FIN_BAIA > 0 and MIS_D_CORRIDOIO > 0 then MIS_FIN_BAIA
                                                             when MIS_S_BAIA <> 0 then MIS_S_BAIA 
                                                             else cs.COR_DEC_BAIA 
                                                        end and BCOR_CORRIDOIO = cd.COR_CORRIDOIO)
  left outer join MAG_GR_BAIE_INTERNE on (GBINT_GRUPPO = BCOR_GRUPPO)
where MIS_MISSIONE = @idMissione
if @@rowcount < 1
begin
  select @retVal = -2, @errore = dbo.fn_tu('Missione non trovata !')
  goto exit_fn
end

select @udcTipo = UDC_TIPOUDC
      ,@tipoDeclass = UPR_TIPODECLASS
      ,@claAlt = UDC_CLAALT
      ,@pesoUdc = case when UDC_PESOREALE <= 0 then UDC_PESOTEO else UDC_PESOREALE end
      ,@claMov = case when UDC_ORDINE <> '' then 1 else UDC_CLAMOV end
      ,@ord = UDC_ORDINE
      ,@fami = UDC_FAMIUDC
      ,@udcPred = UDC_UDCPRED
      ,@udcAltezza = UDC_ALTEZZA
      ,@eleAreeUdc = UDC_AREEABI
      ,@corRis = UDC_RIS_CORRIDOIO
      ,@celRis = UDC_RIS_CELLA
      ,@sUdtGestP = UDT_GEST_P  /* Estrazione valore per la gestione del tipo Udc  */
      ,@spe = ORD_SPEDIZIONE
      ,@riemp = UDC_RIEMP
      ,@bUdtCulAbi = UDT_CULABI
      ,@staPrenUdc = UDC_STAPRENUDC
      ,@udcBatchV = UDC_BATCH_V
      ,@nUdcSCorridoio = UDC_S_CORRIDOIO
from dbo.DAT_UDC
  inner join dbo.TIPI_UDC on (UDT_TIPOUDC = UDC_TIPOUDC)
  inner join dbo.DAT_UDC_PRED on (UPR_UDCPRED = UDC_UDCPRED)
  inner join dbo.DAT_ORDINI on (ORD_ORDINE = UDC_ORDINE)
where UDC_UDC = @udc
if @@rowcount < 1
begin
  select @retVal = -2, @errore = dbo.fn_tu('Udc non trovata !')
  goto exit_fn
end

set @corAbiCorr = CASE WHEN @bCdCorAbiIng = 1 AND ISNULL(@bGbIntAbiIng, 1) = 1 AND (@bCdCorAbiPren = 1 OR @ord = '') THEN 1 ELSE 0 END

select @accoppiabile = 0
from dbo.TIPI_CULLE_TRASLO
where CTR_CULLA <> 0
  and @bUdtCulAbi & power(2, (CTR_CULLA - 1)) = 0

/* Get a filtered mission list to use in next queries */
select MIS_MISSIONE, MIS_UDC, MIS_BEG_L1, MIS_S_BAIA, MIS_S_CORRIDOIO, MIS_D_CORRIDOIO, MIS_NOBACK
into #ws_L2_SUSEVOMOPEPESESE_FIB_MASIDAPU_fodopege
from dbo.RUN_MISSIONI
where MIS_MISSIONE <> @idMissione 
  and MIS_D_CORRIDOIO <> 0 
  and MIS_IMB_CELLA_DS = 0 
  and (MIS_L2STA <> 'WC' OR MIS_D_CELLA <> 0) 

/* Modifica per gestire gli accoppiamenti in ingresso ai traslo
	Caricate in una tabella temporanea le missioni per poter elaborare la cronologia delle date
	al fine di utilizzare in ingresso l'ultimo articolo per migliorare gli accoppiamenti
*/
declare @tmpMissioni table(FLD_INDEX int identity(1,1), D_CORRIDOIO int, MISSIONE int, BEG_L1 datetime, ULTIMO_ARTICOLO nvarchar(50) collate database_default, TIPO_UDC nvarchar(5) collate database_default, PRODUZIONE datetime)
insert into @tmpMissioni
select distinct MIS_D_CORRIDOIO, MIS_MISSIONE, MIS_BEG_L1, UDC_ARTICOLO, UDC_UDCPRED
               ,case when UDC_ARTICOLO <> '' and UDC_RIEMP = @riempDef and UDC_FAMIUDC = 'M' then MIN(ISNULL(SCO_DPRO, 0)) else 0 end
from #ws_L2_SUSEVOMOPEPESESE_FIB_MASIDAPU_fodopege
  inner join dbo.DAT_UDC on (UDC_UDC = MIS_UDC)
  left outer join dbo.DAT_SCOMPART on (SCO_UDC = UDC_UDC)
where (MIS_S_BAIA <> 0 or MIS_S_CORRIDOIO <> MIS_D_CORRIDOIO) 
  /* Modifica per la gestione dei moduli decisionali
	  Aggiunto un filtro per considerare solo le missione che hanno superato il punto di non ritorno della missione in esame
	  Aggiunto un filtro per considerare solo i corridoi di destinazione utili
  */
  and (MIS_NOBACK & @valNoBack) = 0
  and (@eleCorBaia = '' or @eleCorBaia like CONCAT('%,', MIS_D_CORRIDOIO, ',%'))
group by MIS_D_CORRIDOIO, MIS_MISSIONE, MIS_BEG_L1, UDC_ARTICOLO, UDC_UDCPRED, UDC_FAMIUDC, UDC_RIEMP /* UDC_NSCO */

/* Calculation of "@tmpMissioni" could return more data for each Corridor/BegL1; 
   this fact generates a problem below during the filling of "@tabTotMissIngCorr", duplicating the records, 
   causing a problem in the next query where is used the @@ROWCOUNT
   For this reason has been added this query to singularize the records */
select D_CORRIDOIO, BEG_L1, MAX(FLD_INDEX) as FLD_INDEX into #ws_L2_SUSEVOMOPEPESESE_FIB_BIBEMEBI
from @tmpMissioni
group by D_CORRIDOIO, BEG_L1
select b.* into #ws_L2_SUSEVOMOPEPESESE_FIB_TEBUBAPABEPUDAMUS
from #ws_L2_SUSEVOMOPEPESESE_FIB_BIBEMEBI a
  inner join @tmpMissioni b on (b.FLD_INDEX = a.FLD_INDEX)

/* Modifica per gestire gli accoppiamenti in ingresso ai traslo
	Caricate in una tabella temporanea i conteggi e la data/ora dell'ultima missione presa in gestione
	al fine di utilizzare in ingresso l'ultimo articolo, per migliorare gli accoppiamenti
*/
Declare @tmpTotMissione table(TOT_D_CORRIDOIO int, TOT_BEG_L1 datetime, TOT_NUM_MIS int, TOT_MIS_DISPARI int)
insert into @tmpTotMissione
select D_CORRIDOIO, MAX(BEG_L1), COUNT(MISSIONE), COUNT(MISSIONE) % 2 from @tmpMissioni group by D_CORRIDOIO

/* Totali missioni gia' destinate a corridoi e non gia' imbarcate dal traslo.
   Considero anche quelle in 'WC', con cella gia' valorizzata (da precedenti moduli decisionali).
   Escludo la missione corrente.
*/
declare @tabTotMissIngCorr table (CORRIDOIO int
                                 ,TOT int
                                  /* Modifica per gestire gli accoppiamenti in ingresso ai traslo
                                   Aggiunto il campo di calcolo per sapere se si sta gestendo un numero dispari di missioni
                                   Aggiunti i campi per l'ultimo articolo in ingresso e data produzione
                                  */
                                 ,MISSIONI_DISPARI int
                                 ,ULTIMO_ARTICOLO nvarchar(50) collate database_default
                                 ,TIPO_UDC nvarchar(5) collate database_default
                                 ,PRODUZIONE datetime 
                                 )

 insert into @tabTotMissIngCorr (CORRIDOIO, TOT
                                ,MISSIONI_DISPARI
                                ,ULTIMO_ARTICOLO
                                ,TIPO_UDC
                                ,PRODUZIONE
)
select TOT_D_CORRIDOIO, TOT_NUM_MIS, TOT_MIS_DISPARI, ULTIMO_ARTICOLO, TIPO_UDC, PRODUZIONE
from @tmpTotMissione
inner join #ws_L2_SUSEVOMOPEPESESE_FIB_TEBUBAPABEPUDAMUS on (D_CORRIDOIO = TOT_D_CORRIDOIO and BEG_L1 = TOT_BEG_L1)
 
/* Totali missioni gia' destinate ai gruppi di baie interne e non gia' imbarcate dal traslo */
declare @tabTotMissIngGBInt table (GBINT int,
                                   TOT int
                                  )
insert into @tabTotMissIngGBInt (GBINT, TOT)
select BCOR_GRUPPO, COUNT(*)
from #ws_L2_SUSEVOMOPEPESESE_FIB_MASIDAPU_fodopege
  inner join dbo.MAG_CORRIDOI cs on (cs.COR_CORRIDOIO = MIS_S_CORRIDOIO)
  inner join dbo.MAG_BAIE_CORRIDOI on (BCOR_BAIA = case when MIS_S_BAIA <> 0 then MIS_S_BAIA else cs.COR_DEC_BAIA end and BCOR_CORRIDOIO = MIS_D_CORRIDOIO)
where MIS_S_CORRIDOIO <> MIS_D_CORRIDOIO
  and BCOR_GRUPPO <> 0
group by BCOR_GRUPPO

/* Se corridoio riservato, scelgo tale corridoio  */
if @corRis <> 0
begin
  select @staCellaRis = CEL_STACELLA
        ,@abiCellaRis = case when (CEL_ABI & CEL_ABI_ING = 1 and CEL_INIBITA = 0 and CEL_STAINV = 'D'
                              and (CEL_CULMASK & COR_CULABI) <> 0 
                              and (CEL_GEST_P IN ('', @sUdtGestP))
                                   /* Correzione culla disabilitata */
                              and (@bUdtCulAbi & COR_CULABI) <> 0
                              and (@culla = 0 OR (CEL_CULMASK & COR_CULABI & power(2, @culla - 1)) <> 0)
                              and (@eleCorBaia = '' or @eleCorBaia like CONCAT('%,', CEL_CORRIDOIO, ',%'))
                              and (@eleAreeUdc = '' or @eleAreeUdc like '%,' + COR_AREA + ',%')
                                  ) then 1 
                             else 0 
                        end
        ,@corD = CEL_CORRIDOIO
        ,@tipoCorrD = COR_TIPOCORR
        ,@corNoTraslo = COR_NO_TRASLO
        ,@corBuffPienoRis = case when ISNULL(tTotMissIngCorr.TOT, 0) < COR_INGMAX and
                                      ((GMG_GRUPPO is not null and (GMG_INGMAX = 0 or ISNULL(tTotMissIngGBInt.TOT, 0) < GMG_INGMAX)) or
                                      (GMG_GRUPPO is null and (ISNULL(GBINT_INGMAX, 0) = 0 or ISNULL(tTotMissIngGBInt.TOT, 0) < ISNULL(GBINT_INGMAX, 0)))
                                      ) then 0 
                                 else 1 
                            end
        ,@corAbiRis = case when COR_ABIING = 1 and ISNULL(GBINT_ABIING, 1) = 1 and (COR_ABIPREN = 1 or @ord = '') then 1 else 0 end
        ,@gateOpen = ISNULL(GCNU_CORRIDOR, 0)
  from dbo.MAG_CELLE
    inner join dbo.MAG_CORRIDOI on (COR_CORRIDOIO = CEL_CORRIDOIO)
    left outer join @tabTotMissIngCorr as tTotMissIngCorr on (tTotMissIngCorr.CORRIDOIO = COR_CORRIDOIO)
    left outer join dbo.MAG_BAIE_CORRIDOI on (BCOR_BAIA = @baiaS AND BCOR_CORRIDOIO = COR_CORRIDOIO)
    left outer join dbo.MAG_GR_BAIE_INTERNE on (GBINT_GRUPPO = BCOR_GRUPPO)
    left outer join dbo.GESTORI_MODULI_GR_BAIE_INTERNE on (GMG_MODULO = @modulo and GMG_GRUPPO = BCOR_GRUPPO)
    left outer join @tabTotMissIngGBInt AS tTotMissIngGBInt on (tTotMissIngGBInt.GBINT = BCOR_GRUPPO)
    left outer join dbo.fn_GEDES_CAMUM_NAPIVO() on (GCNU_CORRIDOR = CEL_CORRIDOIO and GCNU_CELL = CEL_CELLA)
  where CEL_CORRIDOIO = @corRis
    and CEL_CELLA = @celRis
  if @@rowcount <> 1
  begin
    select @retVal = -1, @errore = dbo.fn_tu('Problemi in ricerca corridoio/cella riservati')
    goto exit_fn
  end

  /* Se la cella è associata ad un cancello aperto o non è riservata o è disabilitata o il corridoio è di tipo manuale --> seleziona cella in modo tradizionale */
  if (@gateOpen = 1 or @celRis = 0 or @staCellaRis = 'RIS' and @abiCellaRis = 1 or @tipoCorrD = 'M') and @corAbiRis = 1
  begin
    if @corBuffPienoRis = 0 /*or @fModDecis = 1*/ /* Anche se modulo decisionale */
      goto gestUpdateMiss
    else
    begin
      select @retVal = 1, @errore= dbo.fn_tu('Buffer ingresso pieno (cella riservata) !')
      goto exit_fn
    end
  end
end

select MFC_BLOCK, MFC_PRIO, COR_CORRIDOIO, COR_CELLE_LIB, COR_NO_TRASLO, COR_TIPOCORR, COR_CULABI, COR_GEST_LGV_USER
      ,case when ISNULL(tTotMissIngCorr.TOT, 0) < COR_INGMAX and
                 ((GMG_GRUPPO is not null and (GMG_INGMAX = 0 or ISNULL(tTotMissIngGBInt.TOT, 0) < GMG_INGMAX)) or
                 (GMG_GRUPPO is null and (ISNULL(GBINT_INGMAX, 0) = 0 or ISNULL(tTotMissIngGBInt.TOT, 0) < ISNULL(GBINT_INGMAX, 0)))
                 ) then 0 
            else 1 
       end as COR_BUFFER_FULL
into #ws_L2_SUSEVOMOPEPESESE_FIB_CAGESAPUV_fodopege
from dbo.MAG_CORRIDOI
  inner join dbo.MAG_FRS_CORRIDORS on (MFC_CORRIDOR = COR_CORRIDOIO)
  left outer join @tabTotMissIngCorr as tTotMissIngCorr on (tTotMissIngCorr.CORRIDOIO = COR_CORRIDOIO)
  left outer join dbo.MAG_BAIE_CORRIDOI on (BCOR_BAIA = @baiaS AND BCOR_CORRIDOIO = COR_CORRIDOIO)
  left outer join dbo.MAG_GR_BAIE_INTERNE on (GBINT_GRUPPO = BCOR_GRUPPO)
  left outer join dbo.GESTORI_MODULI_GR_BAIE_INTERNE on (GMG_MODULO = @modulo and GMG_GRUPPO = BCOR_GRUPPO)
  left outer join @tabTotMissIngGBInt AS tTotMissIngGBInt on (tTotMissIngGBInt.GBINT = BCOR_GRUPPO)
where COR_CORRIDOIO > 0      
  and (@eleCorBaia = '' or @eleCorBaia like CONCAT('%,', COR_CORRIDOIO, ',%'))
  and (@eleAreeUdc = '' or @eleAreeUdc like CONCAT('%,', COR_AREA, ',%'))
  and COR_ABIING & ISNULL(GBINT_ABIING, 1) = 1
  and (COR_ABIPREN = 1 or @ord = '')
  and @bUdtCulAbi & COR_CULABI <> 0

/* Ottimizzazione: evito join in query celle */
declare @tabCelleAccorpata table (CEL_CORRIDOIO int
                                 ,CEL_TIPOCELLA nvarchar(5) collate database_default
                                 ,CEL_MAXPESOUDC_CFG decimal(8, 3)
                                 ,CEL_CLAALT int
                                 ,CEL_CLAMOV int
                                 ,CEL_CULMASK int
                                 ,CEL_STACELLA nvarchar(5) collate database_default
                                 ,CEL_BATCH_V nvarchar(500) collate database_default
                                 ,SCN_POS_DIM int
                                 ,SCN_DEP_DIM int
                                 ,SCN_LEV_DIM int
                                 ,TIP_PRIO int
                                 ,TIP_WIDTH int
                                 ,TIP_DEPTH int
                                 ,TIP_LEVELS int
                                 ,TOT_POSTI int
                                 ,TOT_CELLE int
                                 ,TOT_SLOT_FREE int
                                 )
                                 
select distinct 
       MFC_BLOCK, MFC_PRIO
      ,COR_CORRIDOIO, CEL_TIPOCELLA, ISNULL(CEP_MAXPESOUDC_CFG, CEL_MAXPESOUDC_CFG) as CEP_MAXPESOUDC_CFG, CEL_CLAALT, CEL_CLAMOV, CEL_CULMASK, CEL_STACELLA, CEL_CELLA, CEL_BATCH_V, CEL_SLOT_FREE, CEL_SLOT_TOT
      ,SCN_POS_DIM, SCN_DEP_DIM, SCN_LEV_DIM          
      ,TIP_PRIO, TIP_WIDTH, TIP_DEPTH, TIP_LEVELS
into #ws_L2_SUSEVOMOPEPESESE_FIB_TUDACIBE
from #ws_L2_SUSEVOMOPEPESESE_FIB_CAGESAPUV_fodopege
  inner join dbo.MAG_CELLE on (CEL_CORRIDOIO = COR_CORRIDOIO)
  inner join dbo.DAT_UDC_CEL on (TIP_TIPOCELLA = CEL_TIPOCELLA)
  inner join dbo.MAG_CELLE_SECTIONS on (SCN_CORRIDOIO = CEL_CORRIDOIO and SCN_CELLA = CEL_CELLA)
  left outer join dbo.MAG_CELLE_PRO on (CEP_CORRIDOIO = CEL_CORRIDOIO and CEP_CELLA = CEL_CELLA)
  left outer join dbo.fn_GEDES_CAMUM_NAPIVO() on (GCNU_CORRIDOR = CEL_CORRIDOIO and GCNU_CELL = CEL_CELLA)
where CEL_CELLA <> 0
  and CEL_INIBITA = 0
  and CEL_ABI & CEL_ABI_ING = 1 
  and CEL_STAINV = 'D'
  and (CEL_STACELLA in ('L', 'IV') or (CEL_STACELLA = 'IP' and COR_NO_TRASLO = 0 and COR_TIPOCORR = 'A'))
  and CEL_CULMASK & COR_CULABI <> 0
  and (@culla = 0 or (CEL_CULMASK & COR_CULABI & power(2, @culla - 1)) <> 0)
  and TIP_TIPOUDC =  @udcTipo
  and SCN_POS_DIM >= TIP_WIDTH
  and SCN_DEP_DIM >= TIP_DEPTH
  and SCN_LEV_DIM >= TIP_LEVELS
  and SCN_ABI = 1
  and ISNULL(CEP_MAXPESOUDC, CEL_MAXPESOUDC) >= @pesoUdc
  and CEL_CLAALT >= @claAlt
  and CEL_GEST_P in ('', @sUdtGestP)
  and CEL_CLAALT >= @claAlt
  and (@tipoDeclass = 'T'
    or (@tipoDeclass = 'D' and CEL_CLAMOV = @claMov)
    or (@tipoDeclass = 'A' and CEL_CLAMOV >= @claMov)
      )
  and GCNU_CORRIDOR is null /* Cells not joined to an open gate */

insert into @tabCelleAccorpata (CEL_CORRIDOIO, CEL_TIPOCELLA, CEL_MAXPESOUDC_CFG, CEL_CLAALT, CEL_CLAMOV, CEL_CULMASK, CEL_STACELLA
                               ,SCN_POS_DIM, SCN_DEP_DIM, SCN_LEV_DIM                               
                               ,TIP_PRIO, TIP_WIDTH, TIP_DEPTH, TIP_LEVELS
                               ,TOT_POSTI, TOT_CELLE, TOT_SLOT_FREE
                              )
select COR_CORRIDOIO, CEL_TIPOCELLA, CEP_MAXPESOUDC_CFG, CEL_CLAALT, CEL_CLAMOV, CEL_CULMASK, CEL_STACELLA
      ,SCN_POS_DIM, SCN_DEP_DIM, SCN_LEV_DIM
      ,TIP_PRIO, TIP_WIDTH, TIP_DEPTH, TIP_LEVELS
      ,SUM(SCN_POS_DIM * SCN_DEP_DIM * SCN_LEV_DIM), COUNT(CEL_CELLA), SUM(CEL_SLOT_FREE)
from #ws_L2_SUSEVOMOPEPESESE_FIB_TUDACIBE
group by COR_CORRIDOIO, CEL_TIPOCELLA, CEP_MAXPESOUDC_CFG, CEL_CLAALT, CEL_CLAMOV, CEL_CULMASK, CEL_STACELLA
        ,SCN_POS_DIM, SCN_DEP_DIM, SCN_LEV_DIM
        ,TIP_PRIO, TIP_WIDTH, TIP_DEPTH, TIP_LEVELS
        
/* Tabella posti liberi */
declare @tabTipoAltCla table (CORRIDOIO int,
                              TIPOCELLA nvarchar(5) collate database_default,
                              TIPPRIO int,
                              MAXPESOUDC decimal(8, 3),
                              CLAALT int,
                              CLAMOV int,
                              TOT int,
                              TOT_SPACES_AVAIL int
                             )
insert into @tabTipoAltCla (CORRIDOIO,
                            TIPOCELLA,
                            TIPPRIO,
                            MAXPESOUDC, CLAALT, CLAMOV,
                            TOT,
                            TOT_SPACES_AVAIL
                           )
select CEL_CORRIDOIO,
       CEL_TIPOCELLA,
       TIP_PRIO,
       CEL_MAXPESOUDC_CFG, CEL_CLAALT, CEL_CLAMOV,
       SUM(TOT_POSTI),
       SUM(TOT_SLOT_FREE)
from @tabCelleAccorpata
  inner join #ws_L2_SUSEVOMOPEPESESE_FIB_CAGESAPUV_fodopege on (COR_CORRIDOIO = CEL_CORRIDOIO)
  inner join dbo.TIPI_CELLE on (TCE_TIPOCELLA = CEL_TIPOCELLA)
group by CEL_CORRIDOIO, CEL_TIPOCELLA, TIP_PRIO, CEL_MAXPESOUDC_CFG, CEL_CLAALT, CEL_CLAMOV, COR_CELLE_LIB
having /* Solo se numero di celle libere > di quelle da tenere libere per i cella-cella (in caso di cella multi-slot in profondità) */
       SUM(case when (CEL_STACELLA in ('L', 'IV') or (CEL_STACELLA = 'IP' and COR_NO_TRASLO = 0 and COR_TIPOCORR = 'A'))
                 and (CEL_CULMASK & COR_CULABI) <> 0
                 and (SCN_POS_DIM >= TIP_WIDTH and SCN_DEP_DIM >= TIP_DEPTH and SCN_LEV_DIM >= TIP_LEVELS) then TOT_CELLE
                else 0
           end) > case when MAX(TCE_DEPTH) > 1 then COR_CELLE_LIB else 0 end

/* Costruisce tabella totalizzazioni in base alla Udc */
declare @tabTotQtaCorCella table (CORRIDOIO int,
                                  CELLA int,
                                  TOT decimal(11, 2),     /* Quantita' totale, a seconda del contenuto del pallet cambia significato */
                                  TOT_AGG decimal(11, 2), /* Quantita' totale aggiuntiva, a seconda del contenuto del pallet cambia significato */
                                  TOT_PALLET int,         /* Quantita' totale in pallet, a seconda del contenuto del pallet cambia significato */
                                  TOT_AGG_PALLET int      /* Quantita' totale aggiuntiva in pallet, a seconda del contenuto del pallet cambia significato */
                                  PRIMARY KEY CLUSTERED (CORRIDOIO,CELLA)
 )

/* Costruisce tabella totalizzazioni in base alla Udc */
declare @tabTotQtaCor table (CORRIDOIO int PRIMARY KEY,
                             TOT decimal(11, 2),     /* Quantita' totale, a seconda del contenuto del pallet cambia significato */
                             TOT_AGG decimal(11, 2), /* Quantita' totale aggiuntiva, a seconda del contenuto del pallet cambia significato */
                             TOT_PALLET int,         /* Quantita' totale in pallet, a seconda del contenuto del pallet cambia significato */
                             TOT_AGG_PALLET int      /* Quantita' totale aggiuntiva in pallet, a seconda del contenuto del pallet cambia significato */
                            )

declare @tipo nvarchar(max) = N'', @sscc_source nvarchar(max), @bBlocksCalculation bit = 0

/*** ORDER ***/
if @ord > N''
begin

  set @tipo = 'ORDINE'
  
  /* Udc abbinate al mio ordine */
  select UDC_UDC as LO_UDC into #ws_L2_SUSEVOMOPEPESESE_FIB_LESASIPI
  from dbo.DAT_UDC
  where UDC_ORDINE = @ord

  /* Conteggio Udc abbinate al mio ordine */
  insert into @tabTotQtaCorCella (CORRIDOIO, CELLA, TOT, TOT_AGG, TOT_PALLET, TOT_AGG_PALLET)
  select UDC_CORRIDOIO, UDC_CELLA, 0, 0, COUNT(UDC_UDC), SUM(case when UDC_STAPRENUDC = @staPrenUdc then 1 else 0 end)
  from #ws_L2_SUSEVOMOPEPESESE_FIB_LESASIPI
    inner join dbo.DAT_UDC on (UDC_UDC = LO_UDC)
    left outer join dbo.RUN_MISSIONI on (MIS_UDC = UDC_UDC)
    left outer join dbo.TIPI_CAUSALI_MISSIONI ON (CAUM_CAUSMISS = MIS_CAUSMISS)
  where UDC_UBIUDC in ('M', 'I')
    and UDC_STADISPUDC = 'D'
    and (UDC_NESE = 0 or ISNULL(CAUM_ENTRATA, 0) = 1)
    and ISNULL(MIS_L2STA, '') not in ('WC', 'ZZ')  
  group by UDC_CORRIDOIO, UDC_CELLA

end
else
/*** MONO-REFERENCE ***/
if @fami = N'M'
begin

  /* Udc monoreferenza */
  exec @retVal = ws_UIM_GODABIVUBEDASOSUDA @udc, @errore OUTPUT
                                          ,@art OUTPUT, @sub1 OUTPUT, @sub2 OUTPUT, @sscc_source OUTPUT
                                          ,@staMate OUTPUT, @tipoConf OUTPUT, @dPro OUTPUT, @dSca OUTPUT
					        					              ,@tipoGest OUTPUT, null, @fifoV OUTPUT
  if @retVal <> 0
    goto exit_fn

  /* Parametro per indicare quali sottocodici considerare */
  set @ingChoiceArt = dbo.fn_GOPOBEVEMOVEGU('ING_CHOICE_ART', 0)
  if @ingChoiceArt < 0
  begin
    select @retVal = -2, @errore = dbo.fn_tu('Parametro scelta articolo in base ai sottocodici errato !')
    goto exit_fn
  end

  if(@fifoV = 0)
    set @fifoV = 1

  /* Udc col mio stesso batch */
  select UDC_UDC as LB_UDC into #ws_L2_SUSEVOMOPEPESESE_FIB_LESUBEVE
  from dbo.DAT_UDC
  where UDC_BATCH_V = @udcBatchV

  /*** MONO-REFERENCE - FULL ***/
  if @riemp = @riempDef
  begin
  
    set @tipo = N'INTERA'
 
    insert into @tabTotQtaCorCella (CORRIDOIO, CELLA, TOT, TOT_AGG, TOT_PALLET, TOT_AGG_PALLET)
    select UDC_CORRIDOIO, UDC_CELLA
          ,SUM(SCO_GIAC + SCO_VER)
          ,SUM(SCO_GIAC + SCO_VER)
          ,COUNT(distinct UDC_UDC)
          ,COUNT(distinct UDC_UDC)
    from #ws_L2_SUSEVOMOPEPESESE_FIB_LESUBEVE
      inner join dbo.DAT_UDC on (UDC_UDC = LB_UDC)
      inner join dbo.DAT_SCOMPART on (SCO_UDC = UDC_UDC)
      left outer join dbo.RUN_MISSIONI on (MIS_UDC = UDC_UDC)
      left outer join dbo.TIPI_CAUSALI_MISSIONI on (CAUM_CAUSMISS = MIS_CAUSMISS)
    where UDC_FAMIUDC = N'M'
      and UDC_RIEMP = @riempDef
      and UDC_UBIUDC IN ('M', 'I')
      and UDC_STADISPUDC = 'D'
      and UDC_STAPRENUDC = 'D'
      and (UDC_NESE = 0 or ISNULL(CAUM_ENTRATA, 0) = 1)
      and ISNULL(MIS_L2STA, '') not in ('WC', 'ZZ')
    group by UDC_CORRIDOIO, UDC_CELLA

  end
  else
  /*** MONO-REFERENCE - NOT FULL ***/
  begin

    set @tipo = N'SMEZZATA'

    insert into @tabTotQtaCorCella (CORRIDOIO, CELLA, TOT, TOT_AGG, TOT_PALLET, TOT_AGG_PALLET)
    select UDC_CORRIDOIO, UDC_CELLA,
            SUM(SCO_GIAC + SCO_VER),
            SUM(SCO_GIAC + SCO_VER),
            COUNT(distinct UDC_UDC),
            COUNT(distinct UDC_UDC)
    from #ws_L2_SUSEVOMOPEPESESE_FIB_LESUBEVE
      inner join dbo.DAT_UDC on (UDC_UDC = LB_UDC)
      inner join dbo.DAT_SCOMPART on (SCO_UDC = UDC_UDC)
      left outer join dbo.RUN_MISSIONI on (MIS_UDC = UDC_UDC)
      left outer join dbo.TIPI_CAUSALI_MISSIONI on (CAUM_CAUSMISS = MIS_CAUSMISS)
    where UDC_FAMIUDC = N'M'
      and UDC_RIEMP <> @riempDef
      and UDC_UBIUDC IN ('M', 'I')
      and UDC_STADISPUDC = 'D'
      and UDC_STAPRENUDC = 'D'
      and (UDC_NESE = 0 or ISNULL(CAUM_ENTRATA, 0) = 1)
      and ISNULL(MIS_L2STA, '') not in ('WC', 'ZZ')
    group by UDC_CORRIDOIO, UDC_CELLA
  
  end

end
else
/*** MULTI-REFERENCE ***/
if @fami = N'P'
begin

  set @tipo = N'PLURIREFERENZA'

  /* Udc plurireferenza */
  insert into @tabTotQtaCorCella (CORRIDOIO, CELLA, TOT, TOT_AGG, TOT_PALLET, TOT_AGG_PALLET)
  select UDC_CORRIDOIO, UDC_CELLA, 0, 0, COUNT(*), 0
  from dbo.DAT_UDC
    left outer join dbo.RUN_MISSIONI on (MIS_UDC = UDC_UDC)
    left outer join dbo.TIPI_CAUSALI_MISSIONI on (CAUM_CAUSMISS = MIS_CAUSMISS)
  where UDC_FAMIUDC = N'P'
    and UDC_UBIUDC IN ('M', 'I')
    and UDC_STADISPUDC = 'D'
    and UDC_STAPRENUDC = 'D'
    and (UDC_NESE = 0 or ISNULL(CAUM_ENTRATA, 0) = 1)
    and ISNULL(MIS_L2STA, '') not in ('WC', 'ZZ')  
  group by UDC_CORRIDOIO, UDC_CELLA

end
else
/*** EMPTY ***/
if @fami = N'V'
begin

  set @tipo = N'VUOTA'

  /* Udc vuota */
  insert into @tabTotQtaCorCella (CORRIDOIO, CELLA, TOT, TOT_AGG, TOT_PALLET, TOT_AGG_PALLET)
  select UDC_CORRIDOIO, UDC_CELLA, 0, 0, COUNT(*), 0
  from DAT_UDC
    left outer join RUN_MISSIONI on (MIS_UDC = UDC_UDC)
    left outer join TIPI_CAUSALI_MISSIONI on (CAUM_CAUSMISS = MIS_CAUSMISS)
  where UDC_FAMIUDC = N'V'
    and UDC_UBIUDC IN ('M', 'I')
    and UDC_STADISPUDC = 'D'
    and UDC_STAPRENUDC = 'D'
    and (UDC_NESE = 0 or ISNULL(CAUM_ENTRATA, 0) = 1)
    and ISNULL(MIS_L2STA, '') not in ('WC', 'ZZ')  
    and UDC_UDCPRED = @udcPred
  group by UDC_CORRIDOIO, UDC_CELLA

end

--set @bBlocksCalculation = 1


/*  */  
declare @max_blocks int, @max_channels int, @used_blocks int, @used_channels int, @max_open_channels int, @open_channels int, @free_channels int
declare @tabCells table (TC_BLOCK int, TC_CORRIDOR int, TC_CELL int, TC_BATCH nvarchar(max), TC_TOT_SPACES_AVAIL int, TC_TOT_SPACES_USED int, TC_TOT_SPACES int, TC_FULL_BOOKED bit)
declare @tabCorridors table (TC_BLOCK int, TC_CORRIDOR int, TC_BATCH nvarchar(max), TC_TOT_SPACES_USED int, TC_TOT_SPACES_AVAIL int, TC_TOT_SPACES int, TC_TOT_CHANNELS_USED int, TC_TOT_CHANNELS_OPEN int, TC_TOT_CHANNELS_FREE int, TC_TOT_CHANNELS int)
declare @tabBlocks table (TB_BLOCK int, TB_BATCH nvarchar(max), TB_TOT_SPACES_USED int, TB_TOT_SPACES_AVAIL int, TB_TOT_SPACES int, TB_TOT_CHANNELS_USED int, TB_TOT_CHANNELS_OPEN int, TB_TOT_CHANNELS_FREE int, TB_TOT_CHANNELS int)
/* Calculate production rate (DPEQ) */  
declare @expected_production int, @cel_totudc int, @reason nvarchar(max) = '';  

--if @bBlocksCalculation = 1
--begin
--  print N'@bBlocksCalculation = 1 --> Block calculation passed'
  
select COR_CORRIDOIO as SWLWO_CORRIDOIO, CEL_CELLA as SWLWO_CELLA
into #ws_L2_SUSEVOMOPEPESESE_FIB_CABEGEMIGIBOPIBIMADUPAVE
from #ws_L2_SUSEVOMOPEPESESE_FIB_TUDACIBE
  inner join dbo.DAT_UDC on (UDC_CORRIDOIO = COR_CORRIDOIO and UDC_CELLA = CEL_CELLA)
where UDC_ORDINE = ''
group by COR_CORRIDOIO, CEL_CELLA
having COUNT(*) > 0
  
;with TBL_CELLS (TC_CORRIDOIO, TC_CELLA)
as (
    select COR_CORRIDOIO, CEL_CELLA from #ws_L2_SUSEVOMOPEPESESE_FIB_TUDACIBE where CEL_BATCH_V = N''
    union  
    select CORRIDOIO, CELLA from @tabTotQtaCorCella
    )
, TBL_CELLS_WITH_DATA
as (
    select MFC_BLOCK                          as CWD_BLOCK
          ,CEL_CORRIDOIO                      as CWD_CORRIDOI
          ,CEL_CELLA                          as CWD_CELL
          ,CEL_BATCH_V                        as CWD_BATCH
          ,CEL_SLOT_TOT - CEL_SLOT_FREE       as CWD_TOT_SPACES_USED
          ,CEL_SLOT_FREE                      as CWD_TOT_SPACES_AVAIL
          ,CEL_SLOT_TOT                       as CWD_TOT_SPACES
          ,iif(SWLWO_CORRIDOIO is null, 1, 0) as CWD_FULL_BOOKED
    from TBL_CELLS
      inner join dbo.MAG_CELLE on (CEL_CORRIDOIO = TC_CORRIDOIO and CEL_CELLA = TC_CELLA)
      inner join dbo.MAG_FRS_CORRIDORS on (MFC_CORRIDOR = CEL_CORRIDOIO)
      left outer join #ws_L2_SUSEVOMOPEPESESE_FIB_CABEGEMIGIBOPIBIMADUPAVE on (SWLWO_CORRIDOIO = CEL_CORRIDOIO and SWLWO_CELLA = CEL_CELLA)
    --where CEL_BATCH_V in ('', @udcBatchV)
    )
insert into @tabCells (TC_BLOCK, TC_CORRIDOR, TC_CELL, TC_BATCH, TC_TOT_SPACES_USED, TC_TOT_SPACES_AVAIL, TC_TOT_SPACES, TC_FULL_BOOKED)  
select CWD_BLOCK            as TC_BLOCK
      ,CWD_CORRIDOI         as TC_CORRIDOR
      ,CWD_CELL             as TC_CELL
      ,CWD_BATCH            as TC_BATCH
      ,CWD_TOT_SPACES_USED  as TC_TOT_SPACES_USED
      ,CWD_TOT_SPACES_AVAIL as TC_TOT_SPACES_AVAIL
      ,CWD_TOT_SPACES       as TC_TOT_SPACES
      ,CWD_FULL_BOOKED      as TC_FULL_BOOKED
from TBL_CELLS_WITH_DATA
--select * from @tabCells

--/* Cell situation */  
--insert into @tabCells (TC_BLOCK, TC_CORRIDOR, TC_CELL, TC_BATCH, TC_TOT_SPACES_USED, TC_TOT_SPACES_AVAIL, TC_TOT_SPACES, TC_FULL_BOOKED)  
--select MFC_BLOCK                          as TC_BLOCK
--      ,COR_CORRIDOIO                      as TC_CORRIDOI
--      ,CEL_CELLA                          as TC_CELL
--      ,CEL_BATCH_V                        as TC_BATCH
--      ,CEL_SLOT_TOT - CEL_SLOT_FREE       as TC_TOT_SPACES_USED
--      ,CEL_SLOT_FREE                      as TC_TOT_SPACES_AVAIL
--      ,CEL_SLOT_TOT                       as TC_TOT_SPACES
--      --,iif((select count(*) from DAT_UDC with(index(IX_DAT_UDC_CORRIDOIO_CELLA)) where UDC_CORRIDOIO = CEL_CORRIDOIO and UDC_CELLA = CEL_CELLA and UDC_ORDINE = '') > 0, 0, 1)   as TC_FULL_BOOKED
--      ,iif(SWLWO_CORRIDOIO is null, 1, 0) as TC_FULL_BOOKED
----from @tabCelleAccorpata  
--from #ws_L2_SUSEVOMOPEPESESE_FIB_TUDACIBE
--  --inner join MAG_CORRIDOI on COR_CORRIDOIO = CEL_CORRIDOIO  
--  left outer join #ws_L2_SUSEVOMOPEPESESE_FIB_CABEGEMIGIBOPIBIMADUPAVE on (SWLWO_CORRIDOIO = COR_CORRIDOIO and SWLWO_CELLA = CEL_CELLA)
--where CEL_BATCH_V in ('', @udcBatchV)  
----group by MFC_BLOCK, COR_CORRIDOIO, CEL_CELLA, CEL_BATCH_V, CEL_SLOT_FREE, CEL_SLOT_TOT

/* Corridor situation */  
insert into @tabCorridors (TC_BLOCK, TC_CORRIDOR, TC_BATCH, TC_TOT_SPACES_USED, TC_TOT_SPACES_AVAIL, TC_TOT_SPACES, TC_TOT_CHANNELS_USED, TC_TOT_CHANNELS_OPEN, TC_TOT_CHANNELS_FREE, TC_TOT_CHANNELS)  
select TC_BLOCK                                                           as TC_BLOCK  
      ,TC_CORRIDOR                                                        as TC_CORRIDOR  
      ,TC_BATCH                                                           as TC_BATCH  
        /* Slots Count */  
      ,SUM(case when TC_BATCH <> '' then TC_TOT_SPACES_USED else 0 end)    as TC_TOT_SPACES_USED  
      ,SUM(TC_TOT_SPACES_AVAIL)                                           as TC_TOT_SPACES_AVAIL  
      ,SUM(TC_TOT_SPACES)                                                 as TC_TOT_SPACES  
        /* Channels Count */  
      ,SUM(case when TC_BATCH <> '' then 1 else 0 end)                    as TC_TOT_CHANNELS_USED  
      ,SUM(case when TC_BATCH <> '' and TC_FULL_BOOKED = 0 and 0 < TC_TOT_SPACES_AVAIL and TC_TOT_SPACES_AVAIL < TC_TOT_SPACES then 1 else 0 end)   as TC_TOT_CHANNELS_OPEN  
      ,SUM(iif(TC_TOT_SPACES = TC_TOT_SPACES_AVAIL, 1, 0))                 as TC_TOT_CHANNELS_FREE  
      ,(  
        select COUNT(*)
        from dbo.MAG_CELLE
          left outer join dbo.fn_GEDES_CAMUM_NAPIVO() on (GCNU_CORRIDOR = CEL_CORRIDOIO and GCNU_CELL = CEL_CELLA)
        where CEL_CORRIDOIO = TC_CORRIDOR
          and CEL_ABI = 1
          and CEL_INIBITA = 0
          and GCNU_CORRIDOR is null /* Cells not joined to an open gate */
        )                                                                as TC_TOT_CHANNELS
from @tabCells  
  --inner join MAG_CORRIDOI on COR_CORRIDOIO = TC_CORRIDOR  
group by TC_BLOCK, TC_CORRIDOR, TC_BATCH
--select * from @tabCorridors
      
/* Block situation */  
insert into @tabBlocks (TB_BLOCK, TB_BATCH, TB_TOT_SPACES_USED, TB_TOT_SPACES_AVAIL, TB_TOT_SPACES, TB_TOT_CHANNELS_USED, TB_TOT_CHANNELS_OPEN, TB_TOT_CHANNELS_FREE, TB_TOT_CHANNELS)  
select TC_BLOCK                       as TB_BLOCK  
      ,TC_BATCH                       as TB_BATCH  
      /* Slots count */  
      ,SUM(TC_TOT_SPACES_USED)        as TB_TOT_SPACES_USED  
      ,SUM(TC_TOT_SPACES_AVAIL)       as TB_TOT_SPACES_AVAIL  
      ,SUM(TC_TOT_SPACES)             as TB_TOT_SPACES  
      /* Channels count */  
      ,SUM(TC_TOT_CHANNELS_USED)      as TB_TOT_CHANNELS_USED  
      ,SUM(TC_TOT_CHANNELS_OPEN)      as TB_TOT_CHANNELS_OPEN  
      ,SUM(TC_TOT_CHANNELS_FREE)      as TB_TOT_CHANNELS_FREE  
      ,SUM(TC_TOT_CHANNELS)           as TB_TOT_CHANNELS  
from @tabCorridors  
group by TC_BLOCK, TC_BATCH
  
  --/* KC Custom - Get max number of aisles and blocks to use */  
  --select @max_blocks = SKR_TOTBLOCKS, @max_channels = SKR_TOTBLOCKS * SKR_TOTCOR  
  --from CUSTOM_SKURANK  
  --where SKR_NAME = @udc_articolo_clagest  
  --if @@rowcount <> 1  
  --begin  
  --  select @max_blocks = 2, @max_channels = 1  
  --end  
      
/* Calculate currencly used block/used channels */  
select @used_blocks   = COUNT(distinct TB_BLOCK)  
      ,@used_channels = SUM(TB_TOT_CHANNELS_USED)  
      ,@open_channels = SUM(TB_TOT_CHANNELS_OPEN)  
from @tabBlocks  
where TB_BATCH <> ''
  
select @cel_totudc = min(TC_TOT_SPACES) from @tabCells;  
  --select @expected_production = dbo.fn_CIDEDO_L2_CABEMOBUVEVUV(@udc);  
    
declare @nCapacity decimal(11,3)

select @nCapacity = case when ART_NSCAPALLET * ART_QTASCA * ART_QTASCAPEZZI > 0 then ART_NSCAPALLET * ART_QTASCA * ART_QTASCAPEZZI
                          when SCO_CAP <> 0 then SCO_CAP 
                          else ISNULL(CAP_CAP, SCO_GIAC + SCO_VER) 
                    end
from dbo.DAT_UDC 
  inner join dbo.DAT_SCOMPART on (SCO_UDC = UDC_UDC) 
  inner join dbo.DAT_ARTICOLI on (ART_ARTICOLO = SCO_ARTICOLO) 
  left outer join dbo.DAT_ARTICOLI_SCO on (CAP_ARTICOLO = SCO_ARTICOLO and CAP_TIPOCONF = SCO_TIPOCONF and CAP_TIPOSCOMP = SCO_TIPOSCOMP) 
where UDC_UDC = @udc
  
select @expected_production = CEILING(SUM(RIG_QTAR - RIG_QTAE) / @nCapacity)
        --@expected_production = SUM(RIG_QTAR) / @nCapacity
        --SUM(RIG_QTAR) as RIG_QTAR, SUM(RIG_QTAE) as RIG_QTAE, SUM(RIG_QTAR - RIG_QTAE) as RIG_QTAR_QTAE, SUM(RIG_QTAR) / @nCapacity as RIG_QTAR_DIV_CAP, SUM(RIG_QTAE) / @nCapacity as RIG_QTAE_DIV_CAP, SUM(RIG_QTAR - RIG_QTAE) / @nCapacity as RIG_QTAR_QTAE_DIV_CAP
from dbo.DAT_ORDINI
  inner join dbo.DAT_ORDINI_RIGHE on (RIG_ORDINE = ORD_ORDINE)
  inner join dbo.DAT_ARTICOLI on (ART_ARTICOLO = RIG_ARTICOLO)
where ORD_TIPOOP in (N'E', N'V')
  and ORD_EXPORDINE = N''
  and RIG_EXPORDINE = N''
  and concat(RIG_ARTICOLO, N'|'
		        ,iif(@ingChoiceArt & 01 > 0, concat(RIG_SUB1,         N'|'), N'')
		        ,iif(@ingChoiceArt & 02 > 0, concat(RIG_SUB2,         N'|'), N'')
		        ,iif(@ingChoiceArt & 04 > 0, concat(RIG_STAMATE,      N'|'), N'')
		        ,iif(@ingChoiceArt & 08 > 0, concat(RIG_TIPOCONF,     N'|'), N'')
		        ,iif(@ingChoiceArt & 16 > 0, concat(RIG_SSCC_SOURCE,  N'|'), N'')
		        ,iif(@ingChoiceArt & 32 > 0, concat(@nCapacity,  N'|'), N'')
		        ,iif(ART_TIPOGESTART = N'F' and ART_FIFOV > 0, concat(datediff(hh, 0, RIG_AVVISO_DPRO) / ART_FIFOV, N'|'), N'')
		        ,iif(ART_TIPOGESTART = N'E' and ART_FIFOV > 0, concat(datediff(hh, 0, RIG_AVVISO_DSCA) / ART_FIFOV, N'|'), N'')
		        --,convert(nvarchar(max), RIG_QTAR)
            --,N'FULL'
            ) = @udcBatchV

select @expected_production += CEILING(SUM(UDC_GIAC) / @nCapacity)
from dbo.DAT_UDC
where UDC_BATCH_V = @udcBatchV
  and UDC_FAMIUDC = N'M'
  and UDC_RIEMP = @riempDef
  and UDC_UBIUDC = 'M'
  and UDC_STADISPUDC = 'D'
  and UDC_STAPRENUDC = 'D'
  and UDC_CELLA = 0
  
select @used_blocks   = isnull(@used_blocks,   0)
      ,@used_channels = isnull(@used_channels, 0)
      ,@open_channels = isnull(@open_channels, 0)
  
declare @bUseNumBlocksAsLimit bit = dbo.fn_GOPOBEVEMOVEGU(N'FRS_BLOCK_LIM', 0)
if isnull(@expected_production, 0) > 0
begin
  /* Data based on p.rate */
  select @reason       = 'by p. rate'
        ,@max_channels = round(1.00 * @expected_production / @cel_totudc, 0)
        ,@max_blocks        = dbo.fn_mub(@max_blocks, @max_channels)
        ,@max_open_channels = case when @bUseNumBlocksAsLimit = 0 then dbo.fn_mop(@max_channels, @open_channels)
                                    else dbo.fn_mub(@used_blocks , iif(@max_channels - @used_channels >= 1, @max_channels - @used_channels, 1))
                              end
end
else
begin
  
  declare @nCellsPallelIn int
  select @nCellsPallelIn = ART_CELLS_PARALLEL_IN from dbo.DAT_ARTICOLI where ART_ARTICOLO = @art
  if @nCellsPallelIn is null
    select @nCellsPallelIn = ISNULL(CLA_CELLS_PARALLEL_IN, @used_blocks) from dbo.CLA_MOV where CLA_CLAMOV = @claMov
  
  /* No p.rate */
  select @max_blocks        = case when @bUseNumBlocksAsLimit = 0 then @nCellsPallelIn
                                    else iif(@caum_rientro = 0, 2, 1)
                              end
        ,@max_channels      = @max_blocks
        ,@max_open_channels = @max_channels
end
  
print CONCAT(N'@expected_production: ', @expected_production
            ,N'; @nCapacity: ', @nCapacity
            ,N'; @cel_totudc: ', @cel_totudc
            ,N'; @used_blocks: ', @used_blocks
            ,N'; @used_channels: ', @used_channels
            ,N'; @open_channels: ', @open_channels
            ,N'; @reason: ', @reason
            ,N'; @max_channels: ', @max_channels
            ,N'; @max_blocks: ', @max_blocks
            ,N'; @max_open_channels: ', @max_open_channels
            ,N'; @tipo: ', @tipo)              

--end

/* Sommatoria per corridoi dei conteggi precedenti */
insert into @tabTotQtaCor (CORRIDOIO, TOT, TOT_AGG, TOT_PALLET, TOT_AGG_PALLET)
select CORRIDOIO, SUM(TOT), SUM(TOT_AGG), SUM(TOT_PALLET), SUM(TOT_AGG_PALLET)
from @tabTotQtaCorCella
group by CORRIDOIO

declare @timeout int = dbo.fn_GOPOBEVEMOVEGU('FRS_WC_TIMEOUT', 60)  
declare @timeout_expired bit = case when datediff(second, @mis_beg_req_cor, getdate()) >= @timeout then 1 else 0 end  

/* Carica i corridoi disponibili */  
select distinct  
       MFC_BLOCK  as TB_BLOCK  
      ,TB_BATCH  
      ,TB_TOT_CHANNELS_USED  
      ,TB_TOT_CHANNELS_OPEN  
      ,TB_TOT_CHANNELS_FREE  
      ,TB_TOT_CHANNELS  
      ,TB_TOT_SPACES_AVAIL  
       /**/  
      ,COR_CORRIDOIO          as TC_CORRIDOR  
      ,TC_BATCH  
       /**/  
      ,TC_TOT_CHANNELS_USED  
      ,TC_TOT_CHANNELS_OPEN  
      ,TC_TOT_CHANNELS_FREE  
      ,TC_TOT_CHANNELS  
      ,isnull(TC_TOT_SPACES_AVAIL, tTipoAltCla.TOT_SPACES_AVAIL)  as TC_TOT_SPACES_AVAIL  
      ,isnull(TC_TOT_SPACES,       tTipoAltCla.TOT)               as TC_TOT_SPACES
       /**/  
      ,@max_blocks         as MAX_BLOCKS  
      ,@used_blocks        as USED_BLOCKS  
      ,@max_channels       as MAX_CHANNELS  
      ,@used_channels      as USED_CHANNELS  
      ,@max_open_channels  as MAX_OPEN_CHANNELS  
      ,@open_channels      as OPEN_CHANNELS  
       /* Evaluate custom blocks/channels priority */  
      ,case when TC_BLOCK is null                                                 then '*' /* Block calculation not used, as orders, multi-reference or mono-reference not full (empty string is used as a special check in next query; means last in priority) */  
            when @open_channels >= @max_open_channels and TC_BATCH <> @udcBatchV  then ''  /* Limit openable channels reached; Empty channel (empty string is used as a special check in next query; means last in priority) */  
            when @open_channels >= @max_open_channels and TC_BATCH  = @udcBatchV  then 'A' /* Limit openable channels reached; Channel containing my batch --> keep entering there */
            when @used_blocks   <  @max_blocks   and TC_BATCH = ''                then 'B' /* Pallets will be spread accordingly in next query */  
            when @used_channels <  @max_channels and TC_BATCH = ''                then 'B' /* Pallets will be spread accordingly in next query */  
            when @used_blocks   <= @max_blocks   and TC_BATCH = @udcBatchV        then 'C'
            when @used_channels <= @max_channels and TC_BATCH = @udcBatchV        then 'C'
            when TC_BATCH  = @udcBatchV                                           then 'D'
            when TC_BATCH  = ''                                                   then 'E'
            when TC_BATCH != @udcBatchV                                           then 'Y'
                                                                                  else 'Z' /* Should never happen */  
       end as TB_TC_CHANNEL_PRIO  
       /* Evaluate infeed buffer status */  
      --,case when isnull(tMissIngCorr.TOT, 0) < TC_BLOCCO_INGMAX then 0 else 1 end as TB_TC_INFEED_FULL  
      ,case when COR_BUFFER_FULL = 0 then 0 else 1 end as TB_TC_INFEED_FULL  
       /**/  
      ,CLAALT               as TC_CLAALT  
      ,MAXPESOUDC           as TC_MAXPESOUDC
       /**/  
      ,SUM(ISNULL(tQta.TOT_AGG_PALLET, 0)) over (partition by TC_BATCH, MFC_BLOCK)     as TB_TOT_AGG_PALLET
	    ,SUM(ISNULL(tQta.TOT_PALLET, 0))     over (partition by TC_BATCH, MFC_BLOCK)     as TB_TOT_PALLET
	    ,SUM(ISNULL(tQta.TOT_AGG, 0))        over (partition by TC_BATCH, MFC_BLOCK)     as TB_TOT_AGG
	    ,SUM(ISNULL(tQta.TOT, 0))            over (partition by TC_BATCH, MFC_BLOCK)     as TB_TOT
       /**/
	    ,SUM(ISNULL(tQta.TOT_AGG_PALLET, 0)) over (partition by TC_BATCH, COR_CORRIDOIO) as TC_TOT_AGG_PALLET
	    ,SUM(ISNULL(tQta.TOT_PALLET, 0))     over (partition by TC_BATCH, COR_CORRIDOIO) as TC_TOT_PALLET
	    ,SUM(ISNULL(tQta.TOT_AGG, 0))        over (partition by TC_BATCH, COR_CORRIDOIO) as TC_TOT_AGG
	    ,SUM(ISNULL(tQta.TOT, 0))            over (partition by TC_BATCH, COR_CORRIDOIO) as TC_TOT
       /**/  
      ,COR_TIPOCORR         as TC_TIPOCORR  
      ,COR_NO_TRASLO       as TC_NO_TRASLO  
      ,COR_GEST_LGV_USER    as TC_GEST_LGV_USER  
into #ws_L2_SUSEVOMOPEPESESE_FIB_AISOPISIGACUBOBISA  
FROM @tabTipoAltCla AS tTipoAltCla  
  inner join #ws_L2_SUSEVOMOPEPESESE_FIB_CAGESAPUV_fodopege on (COR_CORRIDOIO = tTipoAltCla.CORRIDOIO)
  left outer join @tabTotQtaCor as tQta on tQta.CORRIDOIO = tTipoAltCla.CORRIDOIO  
  left outer join @tabCorridors on TC_CORRIDOR = COR_CORRIDOIO  
  left outer join @tabBlocks on TB_BLOCK = TC_BLOCK and TB_BATCH = TC_BATCH  
where (@timeout_expired = 1 or isnull(TC_TOT_SPACES_AVAIL, tTipoAltCla.TOT_SPACES_AVAIL) > 0)  

if @bShowDebugQuery = 1
  select '#ws_L2_SUSEVOMOPEPESESE_FIB_AISOPISIGACUBOBISA', * from #ws_L2_SUSEVOMOPEPESESE_FIB_AISOPISIGACUBOBISA
  
/* Lookup optimal channel */  
select  /* Temp: to improve FRS cell saturation CUSTOM - per l'ingresso si va a scegliere il corridoio in cui se ha lo stesso batch e c'è spazio nelle celle va in base saturazione per il rientro guarda il le profondità libere */
       case when @caum_causmiss = N'RSP' and TB_BATCH = @udcBatchV and TC_TOT_SPACES_AVAIL > 0 then (TC_TOT_SPACES - TC_TOT_SPACES_AVAIL) * 1.0 / TC_TOT_SPACES * -1
            else 999 
       end as TAPPA_BUCHI
        /* Priority to best channel choice */
      ,case when isnull(TB_TC_CHANNEL_PRIO, '') <> '' then TB_TC_CHANNEL_PRIO else 'Z-999' end as TB_TC_CHANNEL_PRIO_RES
        /* Temp: to improve FRS cell saturation CUSTOM - per l'ingresso si va a scegliere il corridoio in cui se ha lo stesso batch e c'è spazio nelle celle va in base saturazione per il rientro guarda il le profondità libere */
      ,case when TB_BATCH = @udcBatchV and TC_TOT_SPACES_AVAIL > 0 then (TC_TOT_SPACES - TC_TOT_SPACES_AVAIL) * 1.0 / TC_TOT_SPACES * case when @caum_causmiss = N'RSP' then -1 else +1 end
            else 999 
       end as CELL_SATURATION

        /* Priority to weight */
      ,TC_MAXPESOUDC
        /* Priority to height */
      ,TC_CLAALT
        /* Priority to level with many open channels to close them */
      ,TC_TOT_CHANNELS_OPEN * 1.0 / TC_TOT_CHANNELS as TC_TOT_CHANNELS_OPEN_PRIO
        /* Interi-smezzati: Corridoio con meno pallet dello stesso fifo */
      ,case when @tipo IN ('INTERA', 'SMEZZATA', 'ORDINE') then TB_TOT_AGG_PALLET else TB_TOT_PALLET end * 1.0 / TB_TOT_CHANNELS as TB_ORD_AGG
      ,case when @tipo IN ('INTERA', 'SMEZZATA', 'ORDINE') then TC_TOT_AGG_PALLET else TC_TOT_PALLET end * 1.0 / TC_TOT_CHANNELS as TC_ORD_AGG
        /* Interi-smezzati: Corridoio con meno pallet di fifo differente */
      ,case when @tipo IN ('INTERA', 'SMEZZATA', 'ORDINE') then TB_TOT_PALLET else 0 end * 1.0 / TB_TOT_CHANNELS as TB_ORD_NOAGG
      ,case when @tipo IN ('INTERA', 'SMEZZATA', 'ORDINE') then TC_TOT_PALLET else 0 end * 1.0 / TC_TOT_CHANNELS as TC_ORD_NOAGG
        /* Interi-smezzati: Corridoio con meno quantita' dello stesso fifo */
      ,case when @tipo IN ('INTERA', 'SMEZZATA') then TB_TOT_AGG else TB_TOT end * 1.0 / TB_TOT_CHANNELS as TB_TOT_AGG2
      ,case when @tipo IN ('INTERA', 'SMEZZATA') then TC_TOT_AGG else TC_TOT end * 1.0 / TC_TOT_CHANNELS as TC_TOT_AGG2
        /* Interi-smezzati: Corridoio con meno quantita' di fifo differente */
      ,case when @tipo IN ('INTERA', 'SMEZZATA') then TB_TOT else 0 end * 1.0 / TB_TOT_CHANNELS as TB_TOT_NOAGG
      ,case when @tipo IN ('INTERA', 'SMEZZATA') then TC_TOT else 0 end * 1.0 / TC_TOT_CHANNELS as TC_TOT_NOAGG
        /* Priority to level with more empty cells */
      ,TB_TOT_CHANNELS_FREE * 1.0 / TB_TOT_CHANNELS as TB_CHANNELS_FREE
      ,TC_TOT_CHANNELS_FREE * 1.0 / TC_TOT_CHANNELS as TC_CHANNELS_FREE
        /* Priority to level with more empty space */
      ,TC_TOT_SPACES_AVAIL
      ,N'***' as FLD_SEPARATOR
      ,TB_BLOCK
      ,TC_CORRIDOR
      ,TB_TC_CHANNEL_PRIO
      ,TB_TC_INFEED_FULL
      ,TC_TIPOCORR
      ,TC_NO_TRASLO
      ,TC_GEST_LGV_USER
      ,TC_TOT_CHANNELS_FREE
      ,TC_TOT_CHANNELS_OPEN
      ,TC_TOT_CHANNELS_USED
      ,0 as FLD_PRIO
      ,ROW_NUMBER() over(order by TC_CORRIDOR) as FLD_INDEX
into #ws_L2_SUSEVOMOPEPESESE_FIB_PAM_CUVESI_LAV
from #ws_L2_SUSEVOMOPEPESESE_FIB_AISOPISIGACUBOBISA as T  
where /* If not forced, I'll look for the optimal position */   
  (@timeout_expired = 0 and TB_TC_CHANNEL_PRIO <> '' and TB_TC_CHANNEL_PRIO not like '%Z%')  
   or /* If forced, I'll look for an available infeed */  
  (@timeout_expired = 1 and TB_TC_INFEED_FULL = 0)

;with TBL_PRIO
as (
    select FLD_INDEX
          ,ROW_NUMBER() over (order by TAPPA_BUCHI
                                       /* Priority to bestchannelchoice*/  
                                      ,TB_TC_CHANNEL_PRIO_RES
                                       /* Temp: to improve FRS cell saturation */  
                                      ,CELL_SATURATION
                                       /* Priority to weight */
                                      ,TC_MAXPESOUDC
                                       /* Priority to height */
                                      ,TC_CLAALT
                                       /* Priority to level with many open channels to close them */  
                                      ,TC_TOT_CHANNELS_OPEN_PRIO desc
                                       /* Interi-smezzati: Corridoio con meno pallet dello stesso fifo */  
                                      ,TB_ORD_AGG
                                      ,TC_ORD_AGG
                                       /* Interi-smezzati: Corridoio con meno pallet di fifo differente */  
                                      ,TB_ORD_NOAGG
                                      ,TC_ORD_NOAGG
                                       /* Interi-smezzati: Corridoio con meno quantita' dello stesso fifo */  
                                      ,TB_TOT_AGG2
                                      ,TC_TOT_AGG2
                                       /* Interi-smezzati: Corridoio con meno quantita' di fifo differente */  
                                      ,TB_TOT_NOAGG
                                      ,TC_TOT_NOAGG
                                       /* Priority to level with more empty cells */  
                                      ,TB_CHANNELS_FREE desc
                                      ,TC_CHANNELS_FREE desc
                                       /* Priority to level with more empty space */   
                                      ,TC_TOT_SPACES_AVAIL desc  
                                      ) FLD_PRIO
    from #ws_L2_SUSEVOMOPEPESESE_FIB_PAM_CUVESI_LAV
    )
update #ws_L2_SUSEVOMOPEPESESE_FIB_PAM_CUVESI_LAV
  set FLD_PRIO = tp.FLD_PRIO
from TBL_PRIO tp
  inner join #ws_L2_SUSEVOMOPEPESESE_FIB_PAM_CUVESI_LAV lo on (lo.FLD_INDEX = tp.FLD_INDEX)

if @bShowDebugQuery = 1
  select '#ws_L2_SUSEVOMOPEPESESE_FIB_PAM_CUVESI_LAV', * from #ws_L2_SUSEVOMOPEPESESE_FIB_PAM_CUVESI_LAV order by FLD_PRIO

/* Debug */  
declare  
   @corr_status_details nvarchar(max) = ''  
  ,@corr_choice nvarchar(max) = ','  
  ,@corr_choice_details nvarchar(max) = '';  
  
select @corr_status_details += concat(TC_CORRIDOR, ' open: ', TC_TOT_CHANNELS_OPEN) + ' | '  
from @tabCorridors;  
select  
    @corr_choice += concat(TC_CORRIDOR, ',' )  
   ,@corr_choice_details += concat(TC_CORRIDOR, ' prio: ', FLD_PRIO, ', best-ch: ', TB_TC_CHANNEL_PRIO, ', infeed-full: ', TB_TC_INFEED_FULL  
                                  ,', max weight: ', TC_MAXPESOUDC, ', max height: ', TC_CLAALT, ' | ')  
--from #ws_L2_SUSEVOMOPEPESESE_FIB_PAM_CUVESI  
from #ws_L2_SUSEVOMOPEPESESE_FIB_PAM_CUVESI_LAV
order by FLD_PRIO;  
  
/* Retrieve first prio */  
set @corD = -1
select top 1
       @corD = TC_CORRIDOR
      ,@tipoCorrD = TC_TIPOCORR
      ,@corNoTraslo = TC_NO_TRASLO
      ,@bCorGestLgv = TC_GEST_LGV_USER
       /**/  
      ,@free_channels = isnull(TC_TOT_CHANNELS_FREE, 0)
      ,@open_channels = isnull(TC_TOT_CHANNELS_OPEN, 0)
      ,@used_channels = isnull(TC_TOT_CHANNELS_USED, 0)
--from #ws_L2_SUSEVOMOPEPESESE_FIB_PAM_CUVESI
from #ws_L2_SUSEVOMOPEPESESE_FIB_PAM_CUVESI_LAV
where TB_TC_INFEED_FULL = 0
order by FLD_PRIO
if isnull(@corD, -1) <= 0  
begin
 --set @errore = case when exists (select * from #ws_L2_SUSEVOMOPEPESESE_FIB_PAM_CUVESI)          then concat(dbo.fn_tu('Attesa canale ottimo nel corridoio'), N': ', @corr_choice)  
 set @errore = case when exists (select * from #ws_L2_SUSEVOMOPEPESESE_FIB_PAM_CUVESI_LAV)      then CONCAT(dbo.fn_tu('Attesa canale ottimo nel corridoio'), N': ', @corr_choice)  
                    when exists (select * from #ws_L2_SUSEVOMOPEPESESE_FIB_AISOPISIGACUBOBISA)  then dbo.fn_tu('Attesa ingresso disponibile')
                                                                                                else dbo.fn_tu('Non trovato corridoio destinazione')
               end
 set @retval = case when exists (select * from #ws_L2_SUSEVOMOPEPESESE_FIB_AISOPISIGACUBOBISA) then 1 else 2 end
  
 goto exit_fn  
end  

gestUpdateMiss:

/* Setta corridoio destinazione sulla missione */
/* Azzero anche la dataora di ultima valutazione WC */
update RUN_MISSIONI 
  set MIS_L2STA = 'WL'
     ,MIS_L1STA = 'PR'
     ,MIS_D_CORRIDOIO = @corD
     ,MIS_D_CELLA = 0
     ,MIS_D_TEO = case when @tipoCorrD = 'A' AND @corNoTraslo = 0 then 1 
                       when @bCorGestLgv = 1 then 1
                       else 0 
                  end
     ,MIS_LOCK_ING = case when @s_Piazzola_FirstModulo <> '' and @s_Piazzola_FirstModulo = MIS_MODULO then MIS_LOCK_ING else 0 end
     ,MIS_NOTE = ''
     ,MIS_BEG_WCOR = 0
where MIS_MISSIONE = @idMissione

/* Eventuale sprenotazione corridoio / cella non scelto */
if @corRis > 0 and @corD <> @corRis
begin
  update dbo.DAT_UDC
    set UDC_RIS_CORRIDOIO = 0
       ,UDC_RIS_CELLA = 0
  where UDC_UDC = @udc
end

if @debug = CAST(1 as bit)
begin
  set @strErrWork = 'Debug: ws_L2_SUSEVOMOPEPESESE_FIB (ws_L2_SOMEMIPESAGE): IdMissione: {0}, manuale: {1}, forzata: {2} !'
  set @strErrWork = dbo.fn_IEGASUBODU(@strErrWork, CAST(ISNULL(@idMissione,0)as nvarchar(max)), 
                                      CAST(ISNULL(@manuale,0)as nvarchar(max)), 
                                      CAST(ISNULL(@d_forzata,0)as nvarchar(max)), default, default)
  exec ws_LAV_AAMOVUBEVA 'EV', @strErrWork, 'LIVELLO2', default, default, default, 3
end

/* Chiamata alla routine di ricerca cella, per la scelta di una cella provvisoria.
   Sara' eventualmente cambiata sulla baia interna di ingresso del corridoio.
*/
exec @retVal = dbo.ws_L2_SOMEMIPESAGE @idMissione = @idMissione
                                     ,@celD = null
                                     ,@posD = null
                                     ,@depD = null
                                     ,@levD = null
                                     ,@errore = @errore OUT
                                     ,@culla = default
                                     ,@manuale = @manuale
                                     ,@d_forzata = @d_forzata
if @retVal <> 0
  goto exit_fn

exit_fn:
  if @fTransaction = 0 begin
    if @RetVal <> 0 begin
      ROLLBACK TRANSACTION
      set @errore = dbo.fn_IEGASUBODU(dbo.fn_tu('Missione {0}, Udc {1} : '), ltrim(str(@idMissione)), CAST(@udc as nvarchar), default, default, default) + @errore
    end
    ELSE
      COMMIT TRANSACTION
  end

return @retVal
