import * as algokit from '@algorandfoundation/algokit-utils';
import algosdk from 'algosdk';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { AlgorandSubscriber } from  '../../src/subscriber';
import TransactionType = algosdk.TransactionType;
import { AlgorandSubscriberConfig } from '../../src/types/subscription';

// Loading environment variables from .env file
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const TRANSACTION_FILE = path.join(__dirname, 'usdc_transactions.json');

// Ensuring environment variables are defined
const ALGOD_SERVER = process.env.ALGOD_SERVER || 'https://mainnet-api.algonode.cloud';
const ALGOD_TOKEN = process.env.ALGOD_TOKEN || '';
const ALGOD_PORT = process.env.ALGOD_PORT || '443';

(async () => {
  const algod = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);

  // Initializing watermark to the starting round
  const startRound = 40714690;
  const endRound = 40714696;
  let watermark = startRound; // Initializing the watermark to startRound

  const subscriberConfig: AlgorandSubscriberConfig = {
    filters: [
      {
        name: 'usdc',
        filter: {
          type: TransactionType.axfer,
          assetId: 31566704, // MainNet: USDC
           minAmount: 1_000_000, // $1
          //appId: 1212658560
          //sender: 'AACCDJTFPQR5UQJZ337NFR56CC44T776EWBGVJG5NY2QFTQWBWTALTEN4A',
        },
      },
    ],
    waitForBlockWhenAtTip: true,
    syncBehaviour: 'sync-oldest', // to Ensure all blocks are synced from the oldest
    maxRoundsToSync: 1, // Syncing one block at a time to control range
    watermarkPersistence: {
      get: async () => watermark,
      set: async (newWatermark: number) => {
        if (newWatermark > endRound) {
          console.log(`Reached the end of the specified block range: ${endRound}`);
          process.exit(0);
        }
        watermark = newWatermark;
      },
    },
  };

  const subscriber = new AlgorandSubscriber(subscriberConfig, algod);

  subscriber.on('usdc', (transfer) => {
    // Ensure transfer and its properties are defined before accessing them
    if (transfer && transfer['confirmed-round'] !== undefined && transfer['asset-transfer-transaction']) {
      const confirmedRound = transfer['confirmed-round'];
      // Filter by block range
      if (confirmedRound >= startRound && confirmedRound <= endRound) {
        const receiver = transfer['asset-transfer-transaction'].receiver;
        const amount = transfer['asset-transfer-transaction'].amount;
        const transactionData = {
          sender: transfer.sender,
          receiver,
          amount: Number(BigInt(amount ?? 0) / 1_000_000n),
          transactionId: transfer.id,
        };
        fs.appendFileSync(TRANSACTION_FILE, JSON.stringify(transactionData) + '\n', 'utf-8');
        console.log(`Transaction data appended to ${TRANSACTION_FILE}`);
        console.log(
          `${transfer.sender} sent ${receiver} USDC$${Number(
            BigInt(amount ?? 0) / 1_000_000n,
          ).toFixed(2)} in transaction ${transfer.id}`,
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
