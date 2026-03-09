import { ethers } from 'ethers';
import { Connection, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { CHAINS, SWEEP_INTERVAL } from './constants.js';

/**
 * Consolidates funds from derived deposit addresses to the main wallet (index 0).
 * Runs on a 5-minute interval.
 */
export class SweepManager {
  constructor(pool, walletManager) {
    this.pool = pool;
    this.walletManager = walletManager;
    this.intervalHandle = null;

    this.ethProvider = new ethers.JsonRpcProvider(CHAINS.ethereum.rpcUrl);
    this.solConnection = new Connection(CHAINS.solana.rpcUrl, 'confirmed');
  }

  start() {
    console.log('SweepManager: starting polling');
    this.intervalHandle = setInterval(() => this.sweep(), SWEEP_INTERVAL);
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async sweep() {
    try {
      await Promise.all([
        this._sweepEthereum(),
        this._sweepSolana(),
      ]);
    } catch (err) {
      console.error('SweepManager error:', err.message);
    }
  }

  async _sweepEthereum() {
    const wallets = await this.walletManager.getWalletAddresses('ethereum');
    const mainWallet = this.walletManager.getMainEthWallet();

    for (const wallet of wallets) {
      if (wallet.derivation_index === 0) continue; // skip main wallet
      try {
        const balance = await this.ethProvider.getBalance(wallet.address);
        // Only sweep if balance > gas cost (~0.001 ETH)
        const minSweep = ethers.parseEther('0.002');
        if (balance <= minSweep) continue;

        const derived = this.walletManager.deriveEthWallet(wallet.derivation_index);
        const signer = new ethers.Wallet(derived.privateKey, this.ethProvider);

        const gasPrice = (await this.ethProvider.getFeeData()).gasPrice;
        const gasLimit = 21000n;
        const gasCost = gasPrice * gasLimit;
        const sweepAmount = balance - gasCost;
        if (sweepAmount <= 0n) continue;

        const tx = await signer.sendTransaction({
          to: mainWallet.address,
          value: sweepAmount,
          gasLimit,
        });
        console.log(`Swept ${ethers.formatEther(sweepAmount)} ETH from ${wallet.address} tx=${tx.hash}`);
      } catch (err) {
        console.error(`ETH sweep failed for ${wallet.address}:`, err.message);
      }
    }
  }

  async _sweepSolana() {
    const wallets = await this.walletManager.getWalletAddresses('solana');
    const mainKeypair = this.walletManager.getMainSolKeypair();

    for (const wallet of wallets) {
      if (wallet.derivation_index === 0) continue;
      try {
        const pubkey = new PublicKey(wallet.address);
        const balance = await this.solConnection.getBalance(pubkey);
        // Keep 0.01 SOL for rent
        const minKeep = 10_000_000; // 0.01 SOL in lamports
        if (balance <= minKeep) continue;

        const sweepAmount = balance - minKeep;
        const derived = this.walletManager.deriveSolKeypair(wallet.derivation_index);

        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: derived.keypair.publicKey,
            toPubkey: mainKeypair.keypair.publicKey,
            lamports: sweepAmount,
          })
        );
        const sig = await sendAndConfirmTransaction(this.solConnection, tx, [derived.keypair]);
        console.log(`Swept ${sweepAmount / 1e9} SOL from ${wallet.address} sig=${sig}`);
      } catch (err) {
        console.error(`SOL sweep failed for ${wallet.address}:`, err.message);
      }
    }
  }
}
