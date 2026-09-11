USE [WSBRITVIC]
GO
/****** Object:  StoredProcedure [dbo].[ws_LGV_Redirection]    Script Date: 07/09/2026 08:46:23 ******/
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
/*
	
    Stored procedure called when Lgv machine needs to change the destination
    Sending as parameters the Lgv manager and the list of the LU, Systore changes the destination
    In the list of the LU Lgv can already send a new destination to use (bay/pitch or corridor/cell)
    If the destination is empty, Systore have to select a new one

    The possible redirections are:
    - changing the pitch for the same bay or the cell for the same corridor
    - changing for a temporary parking
    - changing for an evacuation

    Structure for data type "TYPE_LGV_PARAM":
     *[TLP_MISSION] [int] NULL,
     *[TLP_UDC] [decimal](15, 0) NULL,
     *[TLP_LGV_MISS_ID] [bigint] NULL,
      [TLP_CRADLE] [int] NULL,
      [TLP_NPAL] [int] NULL,
      [TLP_PTYPE] [int] NULL,
     *[TLP_BAY] [int] NULL,
     *[TLP_PITCH] [int] NULL,
     *[TLP_COR] [int] NULL,
     *[TLP_CELL] [int] NULL,
      [TLP_POS] [int] NULL,
      [TLP_DEP] [int] NULL,
      [TLP_LEV] [int] NULL,
	    [TLP_LGV_FORK_HEIGHT] [int] NULL,
	    [TLP_LGV_DIST_FROM_END] [int] NULL
      
    (*) indicates the fields to value for this procedure (depending on the destination)

    Returns:
      -1 = Runtime error
       0 = Ok

*/
ALTER PROCEDURE [dbo].[ws_LGV_Redirection]
(
 @pLgvManager   nvarchar(30)            /* Lgv manager (single machine) */
,@pTabLgvParam  TYPE_LGV_PARAM READONLY /* Table containing LU list and position info (bay, pitch, corridor, cell, position, depth, level) */
)
AS
SET NOCOUNT ON
SET XACT_ABORT ON

  declare @msg nvarchar(max) = OBJECT_NAME(@@PROCID), @txterror nvarchar(max), @trancount int, @retVal int, @dDateTimeStart datetime = GETDATE(), @msgXmlMem xml, @bDebug bit = dbo.fn_GetNumFromWork(N'DEBUG_LGV', 0)
  
  if not exists(select GES_GESTORE 
                from dbo.GESTORI 
                where GES_GESTORE = @pLgvManager 
                  and GES_TIPOGEST = N'LGV')
  begin
    select @txterror = dbo.fn_InsTextStr(dbo.fn_td('Gestore non valido!') + N' - ({0})', @pLgvManager, default, default, default, default)
    raiserror(@txterror, 16, 1)
    goto end_err
  end
  
  declare @nNumMissPar int
  select @nNumMissPar = COUNT(*)
  from @pTabLgvParam  
  if @nNumMissPar = 0
  begin
    select @txterror = dbo.fn_td('Elenco missioni vuoto!')
    raiserror(@txterror, 16, 1)
    goto end_err
  end

  --if exists(select 1
  --          from @pTabLgvParam 
  --          having COUNT(DISTINCT ISNULL(TLP_BAY, 0)) > 1                       /* More then one bay set */
  --            or COUNT(DISTINCT ISNULL(TLP_COR, 0)) > 1                         /* More then one corridor set */
  --            or (SUM(ISNULL(TLP_BAY, 0)) > 0 and SUM(ISNULL(TLP_COR, 0)) > 0)  /* Both destination set, bay and corridor */
  --          )
  --begin
  --  select @txterror = dbo.fn_td('Elenco missioni con destinazioni multiple!')
  --  raiserror(@txterror, 16, 1)
  --  goto end_err
  --end
  
  /* If a transaction is not active, opens a new one */
  select @trancount = @@TRANCOUNT
  if @trancount < 1
    begin transaction
        
  declare @sLgvManagerGroup nvarchar(30) = @pLgvManager
  select @sLgvManagerGroup = comp.GES_GESTORE
  from dbo.GESTORI ges
    inner join dbo.GESTORI comp on (comp.GES_COMPONENTE = ges.GES_COMPONENTE)
  where ges.GES_GESTORE = @pLgvManager 
    and ges.GES_TIPOGEST = N'LGV'
    and comp.GES_TIPOGEST = N'GLGV'

  declare @nNumMiss int, @nNumMissValid int
  select @nNumMiss = COUNT(MIS_MISSIONE)
       , @nNumMissValid = SUM(case when MIS_GES_STA = N'EX' and MIS_GES_GESTORE in (@pLgvManager, @sLgvManagerGroup) then 1 else 0 end )
  from @pTabLgvParam 
    inner join dbo.RUN_MISSIONI on (MIS_MISSIONE = TLP_MISSION)

  if @nNumMissPar <> @nNumMiss
  begin
    select @txterror = dbo.fn_td('Elenco missioni non valido!')
    raiserror(@txterror, 16, 1)
    goto end_err
  end

  if @nNumMissPar <> @nNumMissValid
  begin
    select @txterror = dbo.fn_td('Elenco missioni con dati non validi!')
    raiserror(@txterror, 16, 1)
    goto end_err
  end

  declare @nDestinationType int, @nSourceBay int, @nSourceCor int, @nDestBayMaster int, @nDestBay int, @nDestPitchOnMiss int, @nDestPitch int, @nDstPitchLeft int = 0, @nDstPitchRight int = 0, @nDestCor int, @nDestCellOld int, @nDestCell int, @nDestPos int, @nDestPro int, @nDestY int, @nDestZ int, @sTipoUdc nvarchar(5), @bIsEvacuation bit
  
  declare @DESTINATION_TYPE_BAY int = 1
        , @DESTINATION_TYPE_BAY_MULTIPLE_PITCHES int = 2
        , @DESTINATION_TYPE_COR int = 3
  
  select @nDestinationType = case --when MIS_D_BAIA > 0 and TLP_BAY is not null and MIS_D_BAIA <> TLP_BAY then -1
                                  --when MIS_D_CORRIDOIO > 0  and TLP_COR is not null and MIS_D_CORRIDOIO <> TLP_COR then -2
                                  when MIS_D_BAIA > 0 and COUNT(distinct MIS_D_PIAZZOLA) > 1 then @DESTINATION_TYPE_BAY_MULTIPLE_PITCHES
                                  when MIS_D_BAIA > 0 then @DESTINATION_TYPE_BAY
                                  when MIS_D_CORRIDOIO > 0 then @DESTINATION_TYPE_COR
                                  else 0
                             end
       , @nSourceBay = MIS_S_BAIA
       , @nSourceCor = MIS_S_CORRIDOIO
       , @nDestBay = MIS_D_BAIA
       , @nDestBayMaster = BCO_MASTER
       , @nDestPitchOnMiss = MIN(MIS_D_PIAZZOLA)
       , @nDestPitch = MIN(ISNULL(TLP_PITCH, 0))
       , @nDestCor = MIS_D_CORRIDOIO
       , @nDestCellOld = MIS_D_CELLA
       , @nDestCell = ISNULL(TLP_CELL, 0)
       , @sTipoUdc = UDC_TIPOUDC
       , @bIsEvacuation = case when MIS_TIPOMISS = 3 then 1 else 0 end
  from @pTabLgvParam
    inner join dbo.RUN_MISSIONI on (MIS_MISSIONE = TLP_MISSION)
    inner join dbo.DAT_UDC on (UDC_UDC = MIS_UDC)
    inner join dbo.MAG_BAIE on (MIS_D_BAIA = BCO_BAIA)
  group by TLP_BAY, TLP_COR, TLP_CELL, MIS_D_BAIA, MIS_D_CORRIDOIO, MIS_S_BAIA, MIS_S_CORRIDOIO, MIS_D_CELLA, UDC_TIPOUDC, BCO_MASTER, MIS_TIPOMISS
  print CONCAT(N'Destination type ', @nDestinationType)
  if @nDestinationType <= 0
  begin
    select @txterror = dbo.fn_td('Elenco missioni con destinazioni non valide!')
    raiserror(@txterror, 16, 1)
    goto end_err
  end
  
  print CONCAT(N'@nDestinationType:',@nDestinationType, N'@nDestBayMaster:',@nDestBayMaster, N'@nDestBay:',@nDestBay, N'@nDestPitch:',@nDestPitch)

  declare @tblPitches table(INDICE int, PIAZZOLA int)

  if @nDestinationType = @DESTINATION_TYPE_BAY_MULTIPLE_PITCHES
  begin
  
    /* Extraction of the pitches list, using GM_ORD_PIAZZ to sort pitches, to define the left and the right */
    insert into @tblPitches
    select ROW_NUMBER() OVER(ORDER BY GM_ORD_PIAZZ), BPZ_PIAZZOLA
    from dbo.MAG_BAIE_PIAZ
      inner join dbo.GESTORI_MODULI on (GM_PIAZZOLA = BPZ_PIAZZOLA)
    where BPZ_BAIA = @nDestBay
      and BPZ_PIAZZOLA > 0

    declare @hydrol bit=0,@palletIsland bit=0
    
    select top 1 @hydrol =IIF(BCO_USOBAIA like '%,INHYDRAROLL,%' ,1,0)
        ,@palletIsland =IIF(BCO_USOBAIA like '%,FTRDU,%' ,1,0)
      from MAG_BAIE where BCO_MASTER=@nDestBayMaster
      
      if @hydrol=1
        set @palletIsland =0

    declare @usoBaia nvarchar(1000)
    if (@hydrol=1 or  @palletIsland=1) and @bIsEvacuation = 0
    begin
       goto Search_other
    end
    ;with TBL_MASTER_BAYS /* Master bays list, to check the enable flag */
    as (
        select distinct b.BCO_BAIA as FLD_MASTER_BAY, b.BCO_ABI as FLD_MASTER_BAY_ABI
        from dbo.MAG_BAIE b 
          inner join dbo.MAG_BAIE bm on (bm.BCO_MASTER = b.BCO_BAIA)
      )
    select top 1 @nDestBay = BCO_BAIA
    from dbo.MAG_BAIE
      inner join dbo.MAG_BAIE_PIAZ on (BPZ_BAIA = BCO_BAIA)
      inner join dbo.MAG_PIAZZOLE on (PZ_PIAZZOLA = BPZ_PIAZZOLA)
    where BCO_MASTER = @nDestBayMaster
      and BCO_BAIA <> @nDestBay
      and BPZ_PIAZZOLA > 0
      and PZ_PIAZZOLA > 0
      and PZ_PIAZZOLA = case when @nDestPitch = 0 then PZ_PIAZZOLA else @nDestPitch end
      and PZ_PIAZZOLA not in (select tp.PIAZZOLA from @tblPitches tp)
      and ((@nDestPitch > 0)  /* Lgv decides a destination; no checks needed */
           or (@nDestPitch = 0   /* Systore decides a destination; checks needed */
               and BCO_ABI = 1
               and PZ_ABI & PZ_ABI_LGV & PZ_GEST_LGV = 1 
               ---CUSTOM ALE EVA 2025 12 01 3056004102 AGV Movement added check for automatic 
               AND  (PZ_OK_PIAZZOLA =1 AND  (@hydrol=1 or  @palletIsland=1)
               OR 
               /*if it's not hydrol and not palletisland does'not check if is automatic*/
               (@hydrol=0 and  @palletIsland=0))
               and exists (select * from TBL_MASTER_BAYS where FLD_MASTER_BAY = BCO_MASTER and (FLD_MASTER_BAY = 0 or FLD_MASTER_BAY_ABI = 1)) /* If exists a master bay, have to be enabled */
              )
          )
    order by BPZ_PRIOBAIE, BPZ_PRIO,
    
    -----CUSTOM ALE EVA 2025 12 01 3056004102 AGV Movement added order by for available and last used
    PZ_OK_PIAZZOLA_IMP desc,PZ_UPD_PIAZZOLA_IMP
    /* NC : Britvic : Inserire qui eventuale baia master alternativa */
    if @@ROWCOUNT = 0 and @bIsEvacuation = 0
    begin
      
      Search_other:
      --if @palletIsland=0
      --begin
        print 'search other'
        select top 1
          @nDestBay       = d.BCO_BAIA
        ,@nDestBayMaster = d.BCO_MASTER
        from MAG_BAIE
        cross apply dbo.fn_InsFromString(MAG_BAIE.BCO_AUT_ELEBAIE,N',')
        inner join MAG_BAIE as d on d.BCO_MASTER = ELEM
        inner join MAG_BAIE as m on m.BCO_BAIA = d.BCO_MASTER
        inner join dbo.MAG_BAIE_PIAZ on (BPZ_BAIA = d.BCO_BAIA)
        inner join dbo.MAG_PIAZZOLE on (PZ_PIAZZOLA = BPZ_PIAZZOLA)
        where ((MAG_BAIE.BCO_BAIA = @nDestBayMaster
              and @hydrol = 0
              and @palletIsland = 0)
              --CUSTOM ALE EVA 2025 12 01 3056004102 AGV Movement added pallet island if originally want to go in hydrol
              or /*if need to go previusly to hydrol or palletisland to to pallet island*/ 
        ((@hydrol = 1
                or @palletIsland = 1)
              and d.BCO_USOBAIA like '%,FTRDU,%')
            )
            and d.BCO_ABI = 1
            and m.BCO_ABI = 1
            and PZ_PIAZZOLA > 0
            and PZ_ABI & PZ_ABI_LGV & PZ_GEST_LGV=1
            --CUSTOM ALE EVA 2025 12 01 3056004102 AGV Movement added check for automatic only for pallet island and hydrol
                  AND  (PZ_OK_PIAZZOLA =1 AND  (@hydrol=1 or  @palletIsland=1)
                  OR 
                  /*if it's not hydrol and not palletisland does'not check if is automatic*/
                  (@hydrol=0 and  @palletIsland=0))
        order by  PZ_UPD_PIAZZOLA_IMP

        if @@ROWCOUNT = 0
        begin
          set @nDestPitch = 0
          print 'not find pitch dest'
                 /*
                    ---CUSTOM ALE EVA 2025 12 01 3056004102 AGV Movement added check for automatic 
            - fatto nella creazione missione- 

            2	Se però mi viene chiamato il rediredt da lgv allora e voleva andare a o hydrol o pallisland, fa ping pong tra queste due all'infinito

            */
          if @nDestPitch=0 and (@hydrol=1 --se originalmente voleva andare a hydrol  e non c'e' posto o è tutta in manuale CW
                            or @palletIsland=1)  ---3	Se verso island e redir su CW
            begin
               -- select @nDestPitch,@hydrol,@palletIsland
                print 'EVAC ALE'
                goto Evac
            end 
        end
        else 
            print concat('find pitch dest',@nDestBay)
      --end

 
    end
       
    delete from @tblPitches

    /* Extraction of the pitches list, using GM_ORD_PIAZZ to sort pitches, to define the left and the right */
    insert into @tblPitches
    select ROW_NUMBER() OVER(ORDER BY GM_ORD_PIAZZ), BPZ_PIAZZOLA
    from dbo.MAG_BAIE_PIAZ
      inner join dbo.GESTORI_MODULI on (GM_PIAZZOLA = BPZ_PIAZZOLA)
    where BPZ_BAIA = @nDestBay
      and BPZ_PIAZZOLA > 0
       
    /* Right pitch definition */
    select @nDstPitchRight = PIAZZOLA
    from @tblPitches
    where INDICE = 1
    
    /* Left pitch definition */
    select @nDstPitchLeft = PIAZZOLA
    from @tblPitches
    where INDICE = 2
    
    print CONCAT(N'@nDestBayMaster:', @nDestBayMaster, N' - @nDestBay:', @nDestBay, N' - @nDstPitchLeft:', @nDstPitchLeft, N' - @nDstPitchRight:', @nDstPitchRight)

    /* Base pitch forced to 0 (important because it's used in the next checks) */
    set @nDestPitch = 0

  end
  else
  if @nDestinationType = @DESTINATION_TYPE_BAY
  begin

    select top 1 @nDestPitch = PZ_PIAZZOLA
    from dbo.MAG_BAIE
      inner join dbo.MAG_BAIE_PIAZ on (BPZ_BAIA = BCO_BAIA)
      inner join dbo.MAG_PIAZZOLE on (PZ_PIAZZOLA = BPZ_PIAZZOLA)
    where BCO_BAIA = @nDestBay
      and BPZ_PIAZZOLA > 0
      and PZ_PIAZZOLA > 0
      and PZ_PIAZZOLA = case when @nDestPitch = 0 then PZ_PIAZZOLA else @nDestPitch end
      and PZ_PIAZZOLA <> @nDestPitchOnMiss
      and ((@nDestPitch > 0)  /* Lgv decides a destination; no checks needed */
        or (@nDestPitch = 0   /* Systore decides a destination; checks needed */
          and BCO_ABI = 1
          and PZ_ABI & PZ_ABI_LGV & PZ_GEST_LGV /*& PZ_OK_PIAZZOLA & PZ_OK_PIAZZOLA_IMP*/ = 1) /* Automatic and free status is not necessary */
          )
    order by BPZ_PRIOBAIE, BPZ_PRIO
    if @@ROWCOUNT = 0
      set @nDestPitch = 0

  end
  else
  if @nDestinationType = @DESTINATION_TYPE_COR
  begin
  
    select top 1 @nDestCell = CEL_CELLA
    from dbo.MAG_CELLE
    where CEL_CORRIDOIO = @nDestCor
      and CEL_CELLA > 0
      and CEL_CELLA = case when @nDestCell = 0 then CEL_CELLA else @nDestCell end
      and CEL_CELLA <> @nDestCellOld
      and CEL_STACELLA = N'L'
      and ((@nDestCell > 0) /* Lgv decides a destination; no checks needed */
        or (@nDestCell = 0  /* Systore decides a destination; checks needed */
          and CEL_ABI = 1
          and CEL_INIBITA = 0)
          )      
    order by CEL_PRIO, CEL_CELLA
    if @@ROWCOUNT = 0
      set @nDestCell = 0
    else
    select @nDestPos = ISNULL(CSL_POS, 1)
         , @nDestPro = (CEL_PROFMAX - TIP_PROFTOT + 1)
    from dbo.MAG_CELLE
      inner join dbo.DAT_UDC_CEL on (TIP_TIPOCELLA = CEL_TIPOCELLA)
      left outer join dbo.MAG_CELLE_LARG_SPAZI on (CSL_CORRIDOIO = CEL_CORRIDOIO and CSL_CELLA = CEL_CELLA)
    where CEL_CORRIDOIO = @nDestCor
      and CEL_CELLA = @nDestCell
      and TIP_TIPOUDC = @sTipoUdc
    
  end

  declare @tblOutput table (TO_MISSION int NULL
	                        , TO_UDC decimal(15) NULL
	                        , TO_LGV_MISS_ID bigint NULL
                          , TO_CRADLE int NULL
                          , TO_NPAL int NULL
                          , TO_PTYPE int NULL
	                        , TO_BAY_MASTER int NULL /* Additional field respect to the input recordset */
	                        , TO_BAY int NULL
                          , TO_PITCH int NULL
                          , TO_COR int NULL
                          , TO_CELL int NULL
                          , TO_POS int NULL
                          , TO_DEP int NULL
                          , TO_LEV int NULL
	                        , TO_LGV_FORK_HEIGHT int NULL
	                        , TO_LGV_DIST_FROM_END int NULL)

  if @nDestinationType = @DESTINATION_TYPE_BAY and @nDestPitch = 0 and @nDestPitchOnMiss > 0
  begin
    print CONCAT(N'Temporary parking for pitch ', @nDestPitchOnMiss)

    select @nDestCor = PZ_LGV_PARK_CORRIDOIO
    from dbo.MAG_PIAZZOLE
    where PZ_PIAZZOLA = @nDestPitchOnMiss
    if @nDestCor > 0
    begin
      print CONCAT(N'Cell searching for corridor ', @nDestCor)

      select top 1 @nDestCell = CEL_CELLA
      from dbo.MAG_CELLE
      where CEL_CORRIDOIO = @nDestCor
        and CEL_CELLA > 0
        and CEL_STACELLA = N'L'
        and CEL_ABI = 1
        and CEL_INIBITA = 0
      order by CEL_PRIO, CEL_CELLA
      if @@ROWCOUNT > 0      
      begin

        print CONCAT(N'Pos/Dep searching for cell ', @nDestCell)

        select @nDestPos = ISNULL(CSL_POS, 1)
             , @nDestPro = (CEL_PROFMAX - TIP_PROFTOT + 1)
             , @nDestY = dbo.fn_Uti_Dep_Y(CEL_DIMY) /* Height destination */
             , @nDestZ = dbo.fn_Uti_Dep_Z(CEL_DIMZ, CEL_PROFTOT, (CEL_PROFMAX - TIP_PROFTOT + 1)) /* Depth destination */
        from dbo.MAG_CELLE
          inner join dbo.DAT_UDC_CEL on (TIP_TIPOCELLA = CEL_TIPOCELLA)
          left outer join dbo.MAG_CELLE_LARG_SPAZI on (CSL_CORRIDOIO = CEL_CORRIDOIO and CSL_CELLA = CEL_CELLA)
        where CEL_CORRIDOIO = @nDestCor
          and CEL_CELLA = @nDestCell
          and TIP_TIPOUDC = @sTipoUdc
    
        select @nDestinationType = @DESTINATION_TYPE_COR
             , @nDestBay = 0
             , @nDestPitch = 0

      end

    end

  end

  if (@nDestinationType = @DESTINATION_TYPE_BAY and @nDestPitch = 0)
    or (@nDestinationType = @DESTINATION_TYPE_COR and @nDestCell = 0)
  begin
    Evac:

    print N'- Evacuation bay extraction'

    /* Check for evacuation type (for cell or for pitch) */
    declare @bCWonPitch bit = 0
    select @bCWonPitch = case when GES_ATTRIBUTE like N'%,CWP,%' then 1 else 0 end 
    from dbo.GESTORI 
    where GES_GESTORE = @pLgvManager

    declare @nBcoAbbinCorridoio int
              
    select top 1 
            @nDestBay = BCO_BAIA
          , @nDestPitch = PZ_PIAZZOLA
          , @nDestCor = 0
          , @nBcoAbbinCorridoio = BCO_ABBIN_CORRIDOIO
    from dbo.MAG_BAIE
      inner join dbo.MAG_BAIE_PIAZ on (BPZ_BAIA = BCO_BAIA)
      inner join dbo.MAG_PIAZZOLE on (PZ_PIAZZOLA = BPZ_PIAZZOLA)
    where BCO_USOBAIA like '%,CW,%'
      and BCO_ABI = 1
      and (BCO_TIPIUDC = N'' 
        or BCO_TIPIUDC like CONCAT(N'%', @sTipoUdc, N'%'))
      and ((@bCWonPitch = 0 and BCO_ABBIN_CORRIDOIO > 0)
        or @bCWonPitch = 1 and BCO_ABBIN_CORRIDOIO = 0)
      and BPZ_PIAZZOLA > 0
      and PZ_PIAZZOLA > 0
      and PZ_ABI & PZ_ABI_LGV & PZ_GEST_LGV = 1
    order by BPZ_PRIOBAIE, BPZ_PRIO, PZ_OK_PIAZZOLA desc, PZ_OK_PIAZZOLA_IMP desc
    if @@ROWCOUNT = 0
    begin
      select @txterror = dbo.fn_td(N'Baia di evacuazione non trovata')
      raiserror(@txterror, 16, 1)
      goto end_err
    end
    print concat('@nDestBay cW ',@nDestBay)
    if @nDestinationType = @DESTINATION_TYPE_BAY_MULTIPLE_PITCHES
    begin
      /*evangale  evac multiple need to go in different pitch*/
      delete from @tblPitches

      /* Extraction of the pitches list, using GM_ORD_PIAZZ to sort pitches, to define the left and the right */
      insert into @tblPitches
      select ROW_NUMBER() OVER(ORDER BY GM_ORD_PIAZZ), BPZ_PIAZZOLA
      from dbo.MAG_BAIE_PIAZ
        inner join dbo.GESTORI_MODULI on (GM_PIAZZOLA = BPZ_PIAZZOLA)
      where BPZ_BAIA = @nDestBay
        and BPZ_PIAZZOLA > 0
       
      /* Right pitch definition */
      select @nDstPitchRight = PIAZZOLA
      from @tblPitches
      where INDICE = 1
    
      /* Left pitch definition */
      select @nDstPitchLeft = PIAZZOLA
      from @tblPitches
      where INDICE = 2
    
      print CONCAT(N'@nDestBayMaster:', @nDestBayMaster, N' - @nDestBay:', @nDestBay, N' - @nDstPitchLeft:', @nDstPitchLeft, N' - @nDstPitchRight:', @nDstPitchRight)

      /* Base pitch forced to 0 (important because it's used in the next checks) */
      set @nDestPitch = 0

    end
    if @nBcoAbbinCorridoio > 0
    begin    
      print CONCAT(N'Cell searching for corridor ', @nBcoAbbinCorridoio)

      select top 1 @nDestCell = CEL_CELLA
      from dbo.MAG_CELLE
      where CEL_CORRIDOIO = @nBcoAbbinCorridoio
        and CEL_CELLA > 0
        and CEL_STACELLA = N'L'
        and CEL_ABI = 1
        and CEL_INIBITA = 0
      order by CEL_PRIO, CEL_CELLA
      if @@ROWCOUNT > 0      
      begin

        print CONCAT(N'Pos/Dep searching for cell ', @nDestCell)

        select @nDestPos = ISNULL(CSL_POS, 1)
             , @nDestPro = (CEL_PROFMAX - TIP_PROFTOT + 1)
             , @nDestY = dbo.fn_Uti_Dep_Y(CEL_DIMY) /* Height destination */
             , @nDestZ = dbo.fn_Uti_Dep_Z(CEL_DIMZ, CEL_PROFTOT, (CEL_PROFMAX - TIP_PROFTOT + 1)) /* Depth destination */
        from dbo.MAG_CELLE
          inner join dbo.DAT_UDC_CEL on (TIP_TIPOCELLA = CEL_TIPOCELLA)
          left outer join dbo.MAG_CELLE_LARG_SPAZI on (CSL_CORRIDOIO = CEL_CORRIDOIO and CSL_CELLA = CEL_CELLA)
        where CEL_CORRIDOIO = @nBcoAbbinCorridoio
          and CEL_CELLA = @nDestCell
          and TIP_TIPOUDC = @sTipoUdc
    
        select @nDestinationType = @DESTINATION_TYPE_COR
             , @nDestBay = 0
             , @nDestPitch = 0
             , @nDestCor = @nBcoAbbinCorridoio

      end

    end
    
    if @nDestPitch > 0 and @nDestPitch = @nDestPitchOnMiss
    begin
      print N'- Mission already destinated to the evacuation bay/pitch'
      
      insert into @tblOutput (TO_MISSION, TO_UDC, TO_BAY_MASTER, TO_BAY, TO_PITCH)
      select TLP_MISSION, TLP_UDC, @nDestBayMaster, @nDestBay, @nDestPitch from @pTabLgvParam
      
      goto ShowOutput

    end

  end
  
  declare @nOpzione int = 1
    
  select @nOpzione = PER_L1OPCO
  from dbo.L1_PERCORSI 
  where PER_GESTORE = @sLgvManagerGroup 
  and ((PER_S_BAIA = @nSourceBay 
      and @nSourceBay > 0)
    or (PER_S_CORRIDOIO = @nSourceCor 
      and @nSourceCor > 0))
  and ((@nDestBay > 0 
      and PER_D_BAIA = @nDestBay)
    or (@nDestCor > 0 
      and PER_D_CORRIDOIO = @nDestCor))
  and PER_L1PACO = 1 
  and PER_L1STCO = 1 
  if @@ROWCOUNT = 0
  begin
    print dbo.fn_InsTextStr(N'@sLgvManagerGroup:{0};@nSourceBay:{1};@nSourceCor:{2};@nDestBay:{3};@nDestCor:{4};', @sLgvManagerGroup, @nSourceBay, @nSourceCor, @nDestBay, @nDestCor)
    select @txterror = dbo.fn_td(N'Percorso non trovato')
    raiserror(@txterror, 16, 1)
    goto end_err
  end
    
  update dbo.RUN_MISSIONI
    set MIS_GES_STA = N'EX'
      , MIS_D_BAIA = @nDestBay
      , MIS_D_PIAZZOLA = case when @nDestBay > 0 and @nDestPitch = 0 and MIS_H_FIFO = 1 then @nDstPitchRight
                              when @nDestBay > 0 and @nDestPitch = 0 and MIS_H_FIFO = 3 then @nDstPitchRight
                              when @nDestBay > 0 and @nDestPitch = 0 and MIS_H_FIFO = 0 then @nDstPitchLeft
                              when @nDestBay > 0 and @nDestPitch = 0 and MIS_H_FIFO = 2 then @nDstPitchLeft
                              else @nDestPitch
                         end

      , MIS_D_CORRIDOIO = @nDestCor
      , MIS_D_CELLA = @nDestCell
      , MIS_D_POS = ISNULL(@nDestPos, 1)
      , MIS_D_PRO = ISNULL(@nDestPro, 1)
      , MIS_FIN_BAIA = 0
      , MIS_GES_D_MODULO = case when @nDestBay > 0 and @nDestPitch = 0 and MIS_H_FIFO = 1 then dbo.fn_getFirstModPiaz(@nDstPitchRight)
                                when @nDestBay > 0 and @nDestPitch = 0 and MIS_H_FIFO = 3 then dbo.fn_getFirstModPiaz(@nDstPitchRight)
                                when @nDestBay > 0 and @nDestPitch = 0 and MIS_H_FIFO = 0 then dbo.fn_getFirstModPiaz(@nDstPitchLeft)
                                when @nDestBay > 0 and @nDestPitch = 0 and MIS_H_FIFO = 2 then dbo.fn_getFirstModPiaz(@nDstPitchLeft)
                                else dbo.fn_getFirstModPiaz(@nDestPitch)
                           end  
      , MIS_L1PACO        = 1
      , MIS_L1STCO        = 1
      , MIS_L1OPCO        = @nOpzione
      , MIS_ACCOPPIAMENTO = ISNULL(TLP_LGV_MISS_ID, 0)
  output inserted.MIS_MISSIONE
       , inserted.MIS_UDC
       , inserted.MIS_ACCOPPIAMENTO
       , inserted.MIS_TCULLA
       , NULL /* NPAL */
       , NULL /* PTYPE */
       , @nDestBayMaster /* BAY_MASTER */
       , inserted.MIS_D_BAIA
       , inserted.MIS_D_PIAZZOLA
       , inserted.MIS_D_CORRIDOIO
       , inserted.MIS_D_CELLA
       , inserted.MIS_D_POS
       , inserted.MIS_D_PRO
       , 1    /* LEV */
       , NULL /* LGV_FORK_HEIGHT */
       , NULL /* LGV_DIST_FROM_END */
    into @tblOutput
  from @pTabLgvParam
    inner join dbo.RUN_MISSIONI on (MIS_MISSIONE = TLP_MISSION)
  set @retVal = case when @@ERROR <> 0 then -1 else @@ROWCOUNT end
  if @retVal < 0
    goto end_err
  if @retVal <> @nNumMissPar
  begin
    select @txterror = dbo.fn_td(N'Numero missioni aggiornate non valido')
    raiserror(@txterror, 16, 1)
    goto end_err
  end
    
  set @retVal = 0
  
  ShowOutput:

  select TO_MISSION
       , TO_UDC
       , TO_LGV_MISS_ID
       , TO_CRADLE
       , TO_NPAL
       , TO_PTYPE
       , TO_BAY_MASTER
	     , TO_BAY
       , TO_PITCH
       , TO_COR
       , TO_CELL
       , TO_POS
       , TO_DEP
       , TO_LEV
	     , @nDestY as TO_LGV_FORK_HEIGHT
	     , @nDestZ as TO_LGV_DIST_FROM_END
  from @tblOutput
  
/* End with OK */
end_ok:
  if @trancount < 1 and @@TRANCOUNT > 0
    commit transaction
  
  if @bDebug = 1
  begin
    select @msgXmlMem = (select * from @pTabLgvParam as TBL_LGV for xml auto)
         , @msg += case when @txterror > N'' then N' - ' + @txterror else N'' end + dbo.fn_InsTextStr(N' - @pLgvManager:{0} - Execution(ms):{1}', @pLgvManager, DATEDIFF(MS, @dDateTimeStart, GETDATE()), default, default, default)
    exec ws_LOG_AddLogWork N'EV', @msg, @pLgvManager, default, default, default, 3, @msgXmlMem
  end

  return 0

/* End with ERROR */
end_err:
  if @trancount < 1 and @@TRANCOUNT > 0
    rollback transaction
  
  select @msgXmlMem = (select * from @pTabLgvParam as TBL_LGV for xml auto)
       , @msg += case when @txterror > N'' then N' - ' + @txterror else N'' end + dbo.fn_InsTextStr(N' - @pLgvManager:{0} - Execution(ms):{1}', @pLgvManager, DATEDIFF(MS, @dDateTimeStart, GETDATE()), default, default, default)
  exec ws_LOG_AddLogWork N'ERR', @msg, @pLgvManager, default, default, default, 3, @msgXmlMem

  return -1
GO
