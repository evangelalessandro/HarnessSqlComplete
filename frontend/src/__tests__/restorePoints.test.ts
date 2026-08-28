import { describe, expect, it } from 'vitest'
import { buildRestorePoints } from '../helpers'
import type { BackupSetInfo } from '../types'

function mkSet(position: number, type: number, name: string): BackupSetInfo {
  return {
    name,
    description: null,
    type,
    typeDescription: null,
    position,
    serverName: null,
    databaseName: 'DB',
    startDate: `2026-08-28T08:00:0${position}.000`,
    finishDate: `2026-08-28T08:00:0${position}.000`,
    sizeBytes: 1000,
    firstLsn: null,
    lastLsn: null,
    copyOnly: false,
    hasChecksums: false,
    isDamaged: false,
  }
}

describe('buildRestorePoints: tutti i punti/momenti ripristinabili da una catena di backup', () => {
  it('Completo + 2 Differenziali + 2 Log → 5 punti, catena completa per ognuno', () => {
    const sets = [
      mkSet(1, 1, 'FULL'),
      mkSet(2, 5, 'DIFF1'),
      mkSet(3, 5, 'DIFF2'),
      mkSet(4, 2, 'LOG1'),
      mkSet(5, 2, 'LOG2'),
    ]
    const points = buildRestorePoints(sets)
    expect(points).toHaveLength(5)
    expect(points.map(p => p.set.position)).toEqual([1, 2, 3, 4, 5])
    // catena del punto 3: Completo → DIFF1 → DIFF2
    expect(points[2].chain.map(c => c.name)).toEqual(['FULL', 'DIFF1', 'DIFF2'])
    // catena del punto 5 (ultimo): tutti e 5 i set
    expect(points[4].chain.map(c => c.name)).toEqual(['FULL', 'DIFF1', 'DIFF2', 'LOG1', 'LOG2'])
    // ogni punto ha il suo momento (finishDate)
    expect(points.every(p => p.set.finishDate !== null)).toBe(true)
  })

  it('senza Completo nessun punto ripristinabile', () => {
    expect(buildRestorePoints([mkSet(1, 5, 'DIFF'), mkSet(2, 2, 'LOG')])).toHaveLength(0)
  })

  it('un secondo Completo azzera la catena (i punti ripartono dall\'ultimo Completo)', () => {
    const sets = [mkSet(1, 1, 'FULL1'), mkSet(2, 5, 'DIFF1'), mkSet(3, 1, 'FULL2'), mkSet(4, 5, 'DIFF2')]
    const points = buildRestorePoints(sets)
    // 4 punti: FULL1, DIFF1 (dopo FULL1), FULL2, DIFF2 (dopo FULL2)
    expect(points).toHaveLength(4)
    expect(points[0].chain.map(c => c.name)).toEqual(['FULL1'])
    expect(points[1].chain.map(c => c.name)).toEqual(['FULL1', 'DIFF1'])
    expect(points[2].chain.map(c => c.name)).toEqual(['FULL2'])
    expect(points[3].chain.map(c => c.name)).toEqual(['FULL2', 'DIFF2'])
  })

  it('solo Completo → un unico punto', () => {
    expect(buildRestorePoints([mkSet(1, 1, 'FULL')])).toHaveLength(1)
  })
})
