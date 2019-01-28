import * as Logger from 'bunyan'
import { AbstractActionReader } from 'demux'
import { Db, MongoClient } from 'mongodb'
import {
  MongoNotInitializedError,
  MultipleBlockStateError,
  NoBlockStateFoundError,
  RetrieveBlockError,
  RetrieveHeadBlockError,
  RetrieveIrreversibleBlockError,
} from './errors'
import { MongoBlock } from './MongoBlock'
import { retry } from './utils'

/**
 * Implementation of an ActionReader that reads blocks from a mongodb instance.
 */
export class MongoActionReader extends AbstractActionReader {
  protected log: Logger

  private mongodb: Db | null
  private readonly requiredCollections: Set<string> = new Set(['action_traces', 'block_states'])

  constructor(
    protected mongoEndpoint: string = 'mongodb://127.0.0.1:27017',
    public startAtBlock: number = 1,
    protected onlyIrreversible: boolean = false,
    protected maxHistoryLength: number = 600,
    public dbName: string = 'EOS',
  ) {
    super({ startAtBlock, onlyIrreversible, maxHistoryLength })
    this.mongodb = null
    this.log = Logger.createLogger({ name: 'demux' })
  }

  public async initialize(): Promise<void> {
    const mongoInstance = await MongoClient.connect(this.mongoEndpoint, { useNewUrlParser: true })
    this.mongodb = await mongoInstance.db(this.dbName)

    const dbCollections = await this.mongodb.collections()
    if (dbCollections.length === 0) {
      throw new MongoNotInitializedError('There are no collections in the mongodb database')
    }

    const missingCollections = []
    for (const collection of dbCollections) {
      if (!this.requiredCollections.has(collection.collectionName)) {
        missingCollections.push(collection.collectionName)
      }
    }

    if (missingCollections.length > 0) {
      throw new MongoNotInitializedError(`The mongodb database is missing ${missingCollections.join(',')} collections`)
    }

    this.initialized = true
  }

  public async getHeadBlockNumber(numRetries: number = 120, waitTimeMs: number = 250): Promise<number> {
    this.throwIfNotInitialized()

    try {
      const blockNum = await retry(async () => {
        const [blockInfo] = await this.mongodb!.collection('block_states')
          .find({})
          .limit(1)
          .sort({ $natural: -1 })
          .toArray()

        return blockInfo.block_header_state.block_num
      }, numRetries, waitTimeMs)

      return blockNum
    } catch (err) {
      throw new RetrieveHeadBlockError()
    }
  }

  public async getLastIrreversibleBlockNumber(numRetries: number = 120, waitTimeMs: number = 250): Promise<number> {
    this.throwIfNotInitialized()

    try {
      const irreversibleBlockNum = await retry(async () => {
        const [blockInfo] = await this.mongodb!.collection('block_states')
          .find({})
          .limit(1)
          .sort({ $natural: -1 })
          .toArray()

        return blockInfo.block_header_state.dpos_irreversible_blocknum
      }, numRetries, waitTimeMs)

      return irreversibleBlockNum
    } catch (err) {
      throw new RetrieveIrreversibleBlockError()
    }
  }

  public async getBlock(blockNumber: number, numRetries: number = 120, waitTimeMs: number = 250): Promise<MongoBlock> {
    this.throwIfNotInitialized()

    try {
      const mongoBlock = await retry(async () => {
        const blockStates = await this.mongodb!.collection('block_states')
          .find({ block_num: blockNumber })
          .toArray()

        this.validateBlockStates(blockStates, blockNumber)
        const [blockState] = blockStates
        const rawActions = await this.mongodb!.collection('action_traces')
          .find({
            block_num: blockNumber,
            producer_block_id: blockState.block_id,
          })
          .sort({ 'receipt.global_sequence': 1 })
          .toArray()

        return new MongoBlock(blockState, rawActions)
      }, numRetries, waitTimeMs)

      return mongoBlock
    } catch (err) {
      throw new RetrieveBlockError()
    }
  }

  private throwIfNotInitialized() {
    if (!this.mongodb) {
      throw new MongoNotInitializedError()
    }
  }

  private validateBlockStates(blockStates: any, blockNumber: number) {
    if (blockStates.length === 0) {
      throw new NoBlockStateFoundError(blockNumber)
    } else if (blockStates.length > 1) {
      throw new MultipleBlockStateError(blockNumber)
    }
  }
}
