import { ethers } from 'ethers';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@solana/web3.js';
import { CHAINS } from './constants.js';

export class WalletManager {
  constructor(pool) {
    this.pool = pool;
    this.mnemonic = process.env.WALLET_MNEMONIC;
    if (!this.mnemonic) {
      console.warn('WALLET_MNEMONIC not set — wallet operations will fail');
    }
  }

  /**
   * Derive an Ethereum wallet at the given index from the HD mnemonic.
   */
  deriveEthWallet(index) {
    const path = `${CHAINS.ethereum.derivationPath}/${index}`;
    const hdNode = ethers.HDNodeWallet.fromPhrase(this.mnemonic, undefined, path);
    return {
      address: hdNode.address,
      privateKey: hdNode.privateKey,
    };
  }

  /**
   * Derive a Solana keypair at the given index from the HD mnemonic.
   */
  deriveSolKeypair(index) {
    const seed = bip39.mnemonicToSeedSync(this.mnemonic);
    const path = `m/44'/501'/${index}'/0'`;
    const derived = derivePath(path, seed.toString('hex'));
    const keypair = Keypair.fromSeed(derived.key);
    return {
      address: keypair.publicKey.toBase58(),
      keypair,
    };
  }

  /**
   * Create (or return existing) deposit address for a user on a given chain.
   * Atomically increments the derivation index.
   */
  async createDepositAddress(userId, chain) {
    if (!CHAINS[chain]) throw new Error(`Unsupported chain: ${chain}`);

    // Check for existing wallet for this user + chain
    const existing = await this.pool.query(
      'SELECT address FROM wallets WHERE user_id = $1 AND chain = $2 LIMIT 1',
      [userId, chain]
    );
    if (existing.rows.length > 0) {
      return existing.rows[0].address;
    }

    // Atomically get and increment derivation index
    const configKey = chain === 'ethereum' ? 'eth_derivation_index' : 'sol_derivation_index';

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const res = await client.query(
        'UPDATE wallet_config SET value = (value::int + 1)::text, updated_at = NOW() WHERE key = $1 RETURNING value',
        [configKey]
      );
      const index = parseInt(res.rows[0].value, 10); // new index (after increment)

      let address;
      if (chain === 'ethereum') {
        const wallet = this.deriveEthWallet(index);
        address = wallet.address;
      } else {
        const wallet = this.deriveSolKeypair(index);
        address = wallet.address;
      }

      await client.query(
        'INSERT INTO wallets (user_id, chain, address, derivation_index) VALUES ($1, $2, $3, $4)',
        [userId, chain, address, index]
      );

      await client.query('COMMIT');
      return address;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get the main wallet (index 0) for signing withdrawals/sweeps.
   */
  getMainEthWallet() {
    return this.deriveEthWallet(0);
  }

  getMainSolKeypair() {
    return this.deriveSolKeypair(0);
  }

  /**
   * Get all wallet addresses for a given chain (for deposit monitoring).
   */
  async getWalletAddresses(chain) {
    const res = await this.pool.query(
      'SELECT id, user_id, address, derivation_index FROM wallets WHERE chain = $1',
      [chain]
    );
    return res.rows;
  }
}
