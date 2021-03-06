import { NotInitializedError } from 'demux'
import request from 'request-promise-native'
import { nodeosRawBlock } from '../../testHelpers/nodeosRawBlock'
import { NodeosActionReader } from './NodeosActionReader'

describe('NodeosActionReader', () => {
  let reader: NodeosActionReader

  const blockInfo = {
    last_irreversible_block_num: 10,
    head_block_num: 20,
  }

  beforeAll(() => {
    request.get = jest.fn(async () => blockInfo)
    request.post = jest.fn(async () => nodeosRawBlock)
  })

  beforeEach(() => {
    reader = new NodeosActionReader({
      nodeosEndpoint: '',
      startAtBlock: 10,
      onlyIrreversible: false
    })
  })

  it('returns head block number', async () => {
    const blockNum = await reader.getHeadBlockNumber()
    expect(blockNum).toBe(20)
  })

  it('returns last irreversible block number', async () => {
    const blockNum = await reader.getLastIrreversibleBlockNumber()
    expect(blockNum).toBe(10)
  })

  it('gets block with correct block number', async () => {
    const block = await reader.getBlock(20)
    expect(block.blockInfo.blockNumber).toEqual(20)
  })

  it('throws if not correctly initialized', async () => {
    request.get = jest.fn(async () => { throw new Error('404: This page does not exist') })
    reader.getLastIrreversibleBlockNumber = jest.fn(() => blockInfo)
    const result = reader.getNextBlock()
    await expect(result).rejects.toThrow(NotInitializedError)
  })
})
