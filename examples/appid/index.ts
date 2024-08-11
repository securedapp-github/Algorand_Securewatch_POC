//import * as algokit from '@algorandfoundation/algokit-utils';
import algosdk from 'algosdk';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { AlgorandSubscriber } from '../../src/subscriber';
import { AlgorandSubscriberConfig } from '../../src/types/subscription';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const TRANSACTION_FILE = path.join(__dirname, 'app_transactions.json');

// Ensure environment variables are defined
const ALGOD_SERVER = process.env.ALGOD_SERVER || 'https://mainnet-api.algonode.cloud';
const ALGOD_TOKEN = process.env.ALGOD_TOKEN || '';
const ALGOD_PORT = process.env.ALGOD_PORT || '443';

const WATERMARK_FILE = path.join(__dirname, 'watermark.json');

(async () => {
  const algod = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);

  const readWatermark = async () => {
    if (fs.existsSync(WATERMARK_FILE)) {
      const data = fs.readFileSync(WATERMARK_FILE, 'utf-8');
      return JSON.parse(data).watermark;
    }
    return 0;
  };

  const writeWatermark = async (newWatermark: number) => {
    fs.writeFileSync(WATERMARK_FILE, JSON.stringify({ watermark: newWatermark }), 'utf-8');
  };

  let watermark = await readWatermark();

  const startRound = 40685380; // Set your custom start block number here
  const endRound = 40685400; // Set your custom end block number here

  // Ensure the watermark is set to the start block if it's less than startRound
  if (watermark < startRound) {
    watermark = startRound;
    await writeWatermark(watermark);
  }

  const subscriberConfig: AlgorandSubscriberConfig = {
    filters: [
      {
        name: 'app_transactions',
        filter: {
          type: undefined, // Allow all transaction types
          appId: 1212658560,
        },
      },
    ],
    waitForBlockWhenAtTip: true,
    syncBehaviour: 'sync-oldest', // Ensure all blocks are synced from the oldest
    maxRoundsToSync: 1, // Sync one block at a time to control range
    watermarkPersistence: {
      get: async () => watermark,
      set: async (newWatermark) => {
        if (newWatermark > endRound) {
          console.log(`Reached the end of the specified block range: ${endRound}`);
          process.exit(0);
        }
        watermark = newWatermark;
        await writeWatermark(newWatermark);
      },
    },
  };

  const subscriber = new AlgorandSubscriber(subscriberConfig, algod);

  subscriber.on('app_transactions', (transfer) => {
    if (transfer && transfer['confirmed-round'] !== undefined) {
      const confirmedRound = transfer['confirmed-round'];
      if (confirmedRound >= startRound && confirmedRound <= endRound) {
        const transactionData = {
          sender: transfer.sender,
          receiver: transfer['asset-transfer-transaction']?.receiver || null,
          amount: transfer['asset-transfer-transaction'] ? Number(BigInt(transfer['asset-transfer-transaction'].amount ?? 0) / 1_000_000n) : null,
          transactionId: transfer.id,
          type: transfer['tx-type'],
        };
        fs.appendFileSync(TRANSACTION_FILE, JSON.stringify(transactionData) + '\n', 'utf-8');
        console.log(`Transaction data appended to ${TRANSACTION_FILE}`);
        console.log(
          `${transfer.sender} involved in ${transfer['tx-type']} transaction ${transfer.id}`
        );
      }
    }
  });

  subscriber.onError((e) => {
    console.error('Error in subscriber:', e);
  });

  subscriber.start();

  ['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach((signal) =>
    process.on(signal, () => {
      console.log(`Received ${signal}; stopping subscriber...`);
      subscriber.stop(signal);
    }),
  );
})().catch((e) => {
  console.error('Fatal error:', e);
});
