import { ethers } from 'ethers';
import { Connection, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { CHAINS, WITHDRAWAL_POLL_INTERVAL, WITHDRAWAL_RAKE } from './constants.js';

export class WithdrawalProcessor {
  constructor(pool, walletManager, priceService) {
    this.pool = pool;
    this.walletManager = walletManager;
    this.priceService = priceService;
    this.intervalHandle = null;
    this.processing = false;

    this.ethProvider = new ethers.JsonRpcProvider(CHAINS.ethereum.rpcUrl);
    this.solConnection = new Connection(CHAINS.solana.rpcUrl, 'confirmed');
  }

  start() {
    console.log('WithdrawalProcessor: starting polling');
    this.intervalHandle = setInterval(() => this.poll(), WITHDRAWAL_POLL_INTERVAL);
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async poll() {
    if (this.processing) return;
    this.processing = true;

    try {
      const pending = await this.pool.query(
        "SELECT * FROM withdrawals WHERE status = 'pending' ORDER BY created_at LIMIT 10"
      );

      for (const withdrawal of pending.rows) {
        await this._processWithdrawal(withdrawal);
      }
    } catch (err) {
      console.error('WithdrawalProcessor poll error:', err.message);
    } finally {
      this.processing = false;
    }
  }

  async _processWithdrawal(withdrawal) {
    try {
      await this.pool.query(
        "UPDATE withdrawals SET status = 'processing', processed_at = NOW() WHERE id = $1",
        [withdrawal.id]
      );

      let txHash;
      if (withdrawal.chain === 'ethereum') {
        txHash = await this._sendEth(withdrawal);
      } else if (withdrawal.chain === 'solana') {
        txHash = await this._sendSol(withdrawal);
      }

      if (txHash) {
        await this.pool.query(
          "UPDATE withdrawals SET status = 'sent', tx_hash = $1 WHERE id = $2",
          [txHash, withdrawal.id]
        );
        console.log(`Withdrawal sent: ${withdrawal.id} tx=${txHash}`);
      }
    } catch (err) {
      console.error(`Withdrawal ${withdrawal.id} failed:`, err.message);
      await this._refundWithdrawal(withdrawal, err.message);
    }
  }

  async _sendEth(withdrawal) {
    const mainWallet = this.walletManager.getMainEthWallet();
    const signer = new ethers.Wallet(mainWallet.privateKey, this.ethProvider);

    if (withdrawal.asset === 'ETH') {
      const tx = await signer.sendTransaction({
        to: withdrawal.to_address,
        value: ethers.parseEther(withdrawal.amount_crypto.toString()),
      });
      await tx.wait(1);
      return tx.hash;
    } else if (withdrawal.asset === 'USDC_ERC20') {
      const usdcAbi = ['function transfer(address to, uint256 amount) returns (bool)'];
      const contract = new ethers.Contract(CHAINS.ethereum.usdcContract, usdcAbi, signer);
      const amount = BigInt(Math.round(withdrawal.amount_crypto * 10 ** CHAINS.ethereum.usdcDecimals));
      const tx = await contract.transfer(withdrawal.to_address, amount);
      await tx.wait(1);
      return tx.hash;
    }
  }

  async _sendSol(withdrawal) {
    const { keypair } = this.walletManager.getMainSolKeypair();

    if (withdrawal.asset === 'SOL') {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: new PublicKey(withdrawal.to_address),
          lamports: Math.round(withdrawal.amount_crypto * 10 ** CHAINS.solana.nativeDecimals),
        })
      );
      const sig = await sendAndConfirmTransaction(this.solConnection, tx, [keypair]);
      return sig;
    }
    // USDC SPL transfers would use @solana/spl-token createTransferInstruction
    // Simplified for now — can be expanded
    throw new Error('USDC SPL withdrawals not yet implemented');
  }

  async _refundWithdrawal(withdrawal, errorMessage) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Refund tokens to user
      const balRes = await client.query(
        'UPDATE users SET token_balance = token_balance + $1 WHERE id = $2 RETURNING token_balance',
        [withdrawal.amount_tokens, withdrawal.user_id]
      );
      const newBalance = balRes.rows[0].token_balance;

      // Ledger entry for refund
      await client.query(
        `INSERT INTO ledger (user_id, type, amount, balance_after, reference_type, reference_id, description)
         VALUES ($1, 'withdrawal', $2, $3, 'withdrawal', $4, $5)`,
        [withdrawal.user_id, withdrawal.amount_tokens, newBalance, withdrawal.id, `Withdrawal refund: ${errorMessage}`]
      );

      // Mark withdrawal as failed
      await client.query(
        "UPDATE withdrawals SET status = 'failed', error_message = $1 WHERE id = $2",
        [errorMessage, withdrawal.id]
      );

      await client.query('COMMIT');
      console.log(`Withdrawal ${withdrawal.id} refunded: ${withdrawal.amount_tokens} tokens`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Failed to refund withdrawal ${withdrawal.id}:`, err.message);
    } finally {
      client.release();
    }
  }
}
