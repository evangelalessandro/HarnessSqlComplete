import { describe, expect, it } from 'vitest'
import { buildFormatProfile } from '../formatProfile'
import { formatRoutineWithProfile, formatSqlWithProfile, isRoutineText } from '../tsqlFormatter'
import { DEFAULT_FORMAT_PROFILE_XML } from '../formatProfileDefault'

const profile = buildFormatProfile(DEFAULT_FORMAT_PROFILE_XML)

describe('formatSqlWithProfile: keyword ufficiali maiuscole (riferimento Microsoft)', () => {
  it('BACKUP/RESTORE/GRANT/DENY/DBCC vengono maiuscolizzate', () => {
    expect(formatSqlWithProfile("backup database wsdb to disk = 'c:\\x.bak'", profile)).toContain(
      'BACKUP DATABASE wsdb TO DISK',
    )
    expect(formatSqlWithProfile("restore database wsdb from disk = 'c:\\x.bak'", profile)).toContain(
      'RESTORE DATABASE wsdb FROM DISK',
    )
    expect(formatSqlWithProfile('grant select on dbo.t to u', profile)).toContain('GRANT SELECT ON dbo.t TO u')
    expect(formatSqlWithProfile('deny delete on dbo.t to u', profile)).toContain('DENY DELETE ON dbo.t TO u')
    // DBCC è maiuscolo; il sottocomando (checkdb) non è una keyword e resta com'è
    expect(formatSqlWithProfile('dbcc checkdb (wsdb)', profile)).toContain('DBCC checkdb (wsdb)')
  })

  it('costrutti APPLY con a-capo coerente (CROSS APPLY resta unito)', () => {
    const out = formatSqlWithProfile('select * from t cross apply dbo.fn(1) x', profile)
    expect(out).toContain('CROSS APPLY dbo.fn')
  })
})

describe('formatRoutineWithProfile: stored procedure con blocchi (stile Redgate)', () => {
  const proc = `alter procedure [dbo].[ws_L2_EALAPO_AEPOGODIVUG]
(
 @pComponente nvarchar(max) /* Componente */
,@pGestore nvarchar(max) /* Gestore */
,@pOperatore nvarchar(max) = 'SYSTEM' /* Operatore (Opzionale) */
,@pTimeOut int = 0 /* 0 = Timeout infinito (Opzionale) */
)
as
 set nocount on
 set xact_abort on
 declare @retval int = 0
        ,@txtlog nvarchar(max) = ''
 if @pOperatore = ''
   select @pOperatore = 'SYSTEM'
 select @retval = case
                     when @pTimeOut > 20
                       then @pTimeOut - 20
                     else @pTimeOut
                  end
 if @@rowcount < 1
   return 0
 begin
   select @retval = 1
 end
 exec @retval = dbo.ws_UIM_TISEVEPOVI_DOBU @pGestore, @fn_napi, 10
 return @retval
 end_err:
 raiserror ('x', 16, 1)
 return -1
GO`

  it('isRoutineText riconosce le procedure e ignora le query semplici', () => {
    expect(isRoutineText(proc)).toBe(true)
    expect(isRoutineText('select * from t where a = 1')).toBe(false)
  })

  it('firma: intestazione, parentesi e parametri su righe proprie con virgola iniziale', () => {
    const out = formatRoutineWithProfile(proc, profile)
    const lines = out.split('\n')
    expect(lines[0].trim()).toContain('ALTER PROCEDURE [dbo].[ws_L2_EALAPO_AEPOGODIVUG]')
    expect(lines[1].trim()).toBe('(')
    expect(out).toContain('@pComponente')
    expect(out).toContain(',@pGestore')
    expect(out).toContain(',@pOperatore')
    expect(out).toContain("= 'SYSTEM'")
    // i TIPI di dato dei parametri partono tutti dalla stessa colonna (come nel DECLARE)
    const colonneTipo = lines
      .filter(l => /^\s*,?@p\w/.test(l))
      .map(l => l.search(/(NVARCHAR|INT)\b/i))
    expect(colonneTipo.length).toBeGreaterThanOrEqual(4)
    expect(new Set(colonneTipo).size).toBe(1)
    expect(lines.some(l => l.trim() === 'AS')).toBe(true)
  })

  it('corpo: set/declare/select/if/begin/end indentati a 2 spazi per livello', () => {
    const out = formatRoutineWithProfile(proc, profile)
    expect(out).toMatch(/^  SET NOCOUNT ON$/m)
    expect(out).toMatch(/^  SET XACT_ABORT ON$/m)
    expect(out).toMatch(/^  DECLARE @retval INT = 0$/m)
    expect(out).toMatch(/^  IF @pOperatore = ''$/m)
    expect(out).toMatch(/^  BEGIN$/m)
    expect(out).toMatch(/^  END$/m)
    expect(out).toMatch(/^  RETURN @retval$/m)
    // il contenuto di un blocco è indentato di +2
    expect(out).toMatch(/^    SELECT @retval = 1$/m)
  })

  it('CASE multilinea: WHEN/THEN/ELSE su righe proprie con indentazione crescente', () => {
    const out = formatRoutineWithProfile(proc, profile)
    expect(out).toMatch(/^    CASE$/m)
    expect(out).toMatch(/^      WHEN @pTimeOut > 20$/m)
    expect(out).toMatch(/^        THEN @pTimeOut - 20$/m)
    expect(out).toMatch(/^      ELSE @pTimeOut$/m)
    expect(out).toMatch(/^    END$/m)
  })

  it('IF senza BEGIN: il corpo condizionale è indentato', () => {
    const out = formatRoutineWithProfile(proc, profile)
    expect(out).toMatch(/^  IF @@rowcount < 1$/m)
    expect(out).toMatch(/^    RETURN 0$/m)
  })

  it('label a margine (end_err:) e GO a margine', () => {
    const out = formatRoutineWithProfile(proc, profile)
    expect(out).toMatch(/^end_err:$/m)
    expect(out).toMatch(/^GO$/m)
  })

  it('output stabile e terminato da newline', () => {
    const out = formatRoutineWithProfile(proc, profile)
    expect(out.endsWith('\n')).toBe(true)
    expect(formatRoutineWithProfile(proc, profile)).toBe(out)
  })
})

describe('formatRoutineWithProfile: BEGIN ... non deve mai perdere il resto del segmento', () => {
  it('BEGIN TRANSACTION ... ROLLBACK: "TRANSACTION" non scompare (bug utente)', () => {
    const sql = `BEGIN TRANSACTION

  SELECT * FROM dbo.MAG_BAIE_INTERNE ORDER BY 1 DESC

  IF 12 = 0
  BEGIN

  END
ROLLBACK`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toContain('BEGIN TRANSACTION')
    expect(out).toContain('FROM dbo.MAG_BAIE_INTERNE')
    expect(out).toContain('IF 12 = 0')
    expect(out).toContain('ROLLBACK')
    // BEGIN TRANSACTION NON apre un blocco: i statement successivi restano a margine
    expect(out).toMatch(/^BEGIN TRANSACTION$/m)
    // SELECT con FROM/ORDER BY spezzati a clausole (clausole allineate alla SELECT)
    expect(out).toMatch(/^SELECT \*$/m)
    expect(out).toMatch(/^FROM dbo\.MAG_BAIE_INTERNE$/m)
    expect(out).toMatch(/^ORDER BY 1 DESC$/m)
  })

  it('IF + BEGIN TRANSACTION non apre un blocco: niente indentazione dei successivi (bug utente)', () => {
    const sql = `DECLARE @trancount INT = @@trancount
IF @trancount < 1
BEGIN TRANSACTION

EXEC @retVal = ws_L2_LESIVEGUDUVASAP @errore = @txtError out
IF @retVal <> 0
GOTO lblExit`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toMatch(/^IF @trancount < 1\nBEGIN TRANSACTION$/m)
    // i statement successivi restano a margine (non indentati come dentro un BEGIN…END)
    expect(out).toMatch(/^EXEC @retVal = ws_L2_LESIVEGUDUVASAP/m)
    expect(out).toMatch(/^IF @retVal <> 0$/m)
    expect(out).toMatch(/^  GOTO lblExit$/m)
  })

  it('BEGIN TRAN e BEGIN TRY/CATCH con il resto sulla stessa riga: testo preservato', () => {
    const sql = `BEGIN TRAN
  UPDATE dbo.T SET x = 1
COMMIT

BEGIN TRY
  SELECT 1
END TRY
BEGIN CATCH
  PRINT ERROR_MESSAGE()
END CATCH`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toContain('BEGIN TRAN')
    expect(out).toContain('COMMIT')
    expect(out).toContain('BEGIN TRY')
    expect(out).toContain('END TRY')
    expect(out).toContain('BEGIN CATCH')
    expect(out).toContain('END CATCH')
    expect(out).toContain('PRINT ERROR_MESSAGE')
  })

  it('statement di batch (USE/GRANT/BACKUP) su segmenti propri (riferimento Microsoft)', () => {
    const sql = `BEGIN
  USE WSDB
  GRANT SELECT ON dbo.T TO utente
  BACKUP DATABASE WSDB TO DISK = 'C:\\ws.bak'
END`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toMatch(/^BEGIN$/m)
    expect(out).toMatch(/^  USE WSDB$/m)
    expect(out).toMatch(/^  GRANT SELECT ON dbo\.T TO utente$/m)
    expect(out).toMatch(/^  BACKUP DATABASE WSDB TO DISK = 'C:\\ws\.bak'$/m)
    expect(out).toMatch(/^END$/m)
  })

  it('GRANT ... TO: dopo il TO uno statement successivo si spezza di nuovo', () => {
    const sql = `BEGIN
  GRANT SELECT ON dbo.T TO utente
  SELECT 1
END`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toContain('GRANT SELECT ON dbo.T TO utente')
    expect(out).toContain('SELECT 1')
    // GRANT e SELECT su righe diverse (il SELECT non viene inghiottito dal GRANT)
    const grantIdx = out.indexOf('GRANT SELECT')
    const selectIdx = out.indexOf('SELECT 1')
    expect(grantIdx).toBeGreaterThanOrEqual(0)
    expect(selectIdx).toBeGreaterThan(grantIdx)
  })
})

describe('formatRoutineWithProfile: SELECT/INSERT…SELECT con clausole spezzate (come le query semplici)', () => {
  it('INSERT INTO … SELECT: FROM e JOIN a capo, niente riga unica', () => {
    const sql = `BEGIN
  INSERT INTO @tblPitches
  SELECT ROW_NUMBER() OVER (ORDER BY GM_ORD_PIAZZ), BPZ_PIAZZOLA FROM dbo.MAG_BAIE_PIAZ INNER JOIN dbo.GESTORI_MODULI ON (GM_PIAZZOLA = BPZ_PIAZZOLA) WHERE BPZ_BAIA = @nDestBay AND BPZ_PIAZZOLA > 0
END`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toMatch(/^  INSERT INTO @tblPitches$/m)
    // select-list impilata come nel formattatore query: virgola in testa al campo
    expect(out).toMatch(/^  SELECT ROW_NUMBER \(\) OVER \(ORDER BY GM_ORD_PIAZZ\)$/m)
    expect(out).toMatch(/^     ,BPZ_PIAZZOLA$/m)
    expect(out).toMatch(/^  FROM dbo\.MAG_BAIE_PIAZ$/m)
    expect(out).toMatch(/^    INNER JOIN dbo\.GESTORI_MODULI ON \(GM_PIAZZOLA = BPZ_PIAZZOLA\)$/m)
    expect(out).toMatch(/^  WHERE BPZ_BAIA = @nDestBay$/m)
    expect(out).toMatch(/^\s{8}AND BPZ_PIAZZOLA > 0$/m)
  })

  it('SELECT con più campi: select-list impilata anche dentro il blocco', () => {
    const sql = `BEGIN
  SELECT a, b FROM dbo.T INNER JOIN dbo.U ON (T.id = U.id) WHERE x = 1 AND y = 2
END`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toMatch(/^  SELECT a$/m)
    expect(out).toMatch(/^     ,b$/m)
    expect(out).toMatch(/^  FROM dbo\.T$/m)
    expect(out).toMatch(/^    INNER JOIN dbo\.U ON \(T\.id = U\.id\)$/m)
    expect(out).toMatch(/^  WHERE x = 1$/m)
    expect(out).toMatch(/^\s{8}AND y = 2$/m)
    // l'effetto è lo STESSO del formattatore per le query semplici sullo stesso SELECT
    expect(formatRoutineWithProfile(sql, profile)).toContain('SELECT a\n     ,b')
  })

  it('SELECT semplice: WHERE con AND spezzati su righe proprie (come le query semplici)', () => {
    const sql = `BEGIN
  SELECT a, b FROM dbo.T INNER JOIN dbo.U ON (T.id = U.id) WHERE x = 1 AND y = 2 AND z = 3
END`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toMatch(/^  WHERE x = 1$/m)
    expect(out).toMatch(/^        AND y = 2$/m)
    expect(out).toMatch(/^        AND z = 3$/m)
  })

  it(';WITH … AS (SELECT…): parentesi su riga propria PRIMA della SELECT interna', () => {
    const sql = `BEGIN
; WITH TBL_MASTER_BAYS /* Master bays list */ AS (SELECT DISTINCT b.BCO_BAIA AS FLD_MASTER_BAY, b.BCO_ABI AS FLD_MASTER_BAY_ABI FROM dbo.MAG_BAIE b INNER JOIN dbo.MAG_BAIE bm ON (bm.BCO_MASTER = b.BCO_BAIA))
  SELECT TOP 1 @nDestBay = BCO_BAIA FROM dbo.MAG_BAIE WHERE BCO_MASTER = @nDestBayMaster
END`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toMatch(/^  ;WITH TBL_MASTER_BAYS \/\* Master bays list \*\/ AS$/m)
    expect(out).toMatch(/^  \($/m)
    // anche dentro la CTE la select-list è impilata (virgole in testa), come da sola
    expect(out).toMatch(/^    SELECT DISTINCT b\.BCO_BAIA AS FLD_MASTER_BAY$/m)
    expect(out).toMatch(/^       ,b\.BCO_ABI AS FLD_MASTER_BAY_ABI$/m)
    expect(out).toMatch(/^    FROM dbo\.MAG_BAIE b$/m)
    expect(out).toMatch(/^      INNER JOIN dbo\.MAG_BAIE bm ON \(bm\.BCO_MASTER = b\.BCO_BAIA\)$/m)
    expect(out).toMatch(/^  \)$/m)
    // lo statement che usa la CTE segue su riga propria
    expect(out).toMatch(/^  SELECT TOP 1 @nDestBay = BCO_BAIA$/m)
  })
})

describe('formatRoutineWithProfile: header CREATE/ALTER su riga propria dopo i commenti', () => {
  it('commento a blocco prima di CREATE PROCEDURE → CREATE su nuova riga', () => {
    const sql = `/*
    Returns:
      -1 = Runtime error
       0 = Ok

*/ CREATE PROCEDURE [dbo] . [ws_LUP_RUPOVIVIDOP]
(
 @pLgvManager NVARCHAR(30) /* Lgv manager */
)
AS
SET NOCOUNT ON`
    const out = formatRoutineWithProfile(sql, profile)
    expect(out).toMatch(/^\*\/\s*$/m) // il commento chiude su una riga propria
    expect(out).toMatch(/^CREATE PROCEDURE \[dbo\]\.\[ws_LUP_RUPOVIVIDOP\]$/m)
    expect(out).not.toMatch(/\*\/ CREATE/)
  })
})

describe('formatRoutineWithProfile: DECLARE con variabili allineate (stile SQL Prompt)', () => {
  it('virgole in colonna e tipi allineati su più variabili', () => {
    const sql = `declare @nDestinationType int, @nSourceBay int, @nDstPitchLeft int = 0, @sTipoUdc nvarchar(5), @bIsEvacuation bit`
    const out = formatRoutineWithProfile(sql, profile)
    const lines = out.split('\n').filter(l => l.trim().length > 0)
    expect(lines).toHaveLength(5)
    expect(lines[0]).toBe('DECLARE @nDestinationType INT')
    expect(lines[1]).toBe('       ,@nSourceBay       INT')
    expect(lines[2]).toBe('       ,@nDstPitchLeft    INT = 0')
    expect(lines[3]).toBe('       ,@sTipoUdc         NVARCHAR(5)')
    expect(lines[4]).toBe('       ,@bIsEvacuation    BIT')
  })

  it('DECLARE annidato in un blocco mantiene l\'indentazione base e l\'allineamento', () => {
    const sql = `begin
  declare @a int, @bb nvarchar(10)
end`
    const out = formatRoutineWithProfile(sql, profile)
    const lines = out.split('\n').filter(l => l.trim().length > 0)
    // indentazione base (2 spazi dentro BEGIN) + allineamento tipi nella stessa colonna
    expect(lines.find(l => l.includes('DECLARE'))).toMatch(/^  DECLARE @a +INT$/)
    const decl = lines.findIndex(l => l.includes('DECLARE'))
    expect(lines[decl]).toBe('  DECLARE @a  INT')
    expect(lines[decl + 1]).toBe('         ,@bb NVARCHAR(10)')
  })
})
