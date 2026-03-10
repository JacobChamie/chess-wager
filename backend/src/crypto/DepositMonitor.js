import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import { CHAINS, DEPOSIT_POLL_INTERVAL, ERC20_TRANSFER_TOPIC, MIN_DEPOSIT } from './constants.js';

export class DepositMonitor {
  constructor(pool, walletManager, priceService) {
    this.pool = pool;
    this.walletManager = walletManager;
    this.priceService = priceService;
    this.intervalHandle = null;

    // Providers
    this.ethProvider = new ethers.JsonRpcProvider(CHAINS.ethereum.rpcUrl);
    this.solConnection = new Connection(CHAINS.solana.rpcUrl, 'confirmed');
  }

  start() {
    console.log('DepositMonitor: starting polling');
    this.poll(); // run immediately
    this.intervalHandle = setInterval(() => this.poll(), DEPOSIT_POLL_INTERVAL);
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async poll() {
    try {
      await Promise.all([
        this._pollEthereum(),
        this._pollSolana(),
        this._processConfirmations(),
      ]);
    } catch (err) {
      console.error('DepositMonitor poll error:', err.message);
    }
  }

  // --- Ethereum Polling ---

  async _pollEthereum() {
    const wallets = await this.walletManager.getWalletAddresses('ethereum');
    if (wallets.length === 0) return;

    const currentBlock = await this.ethProvider.getBlockNumber();
    const lastBlockRes = await this.pool.query(
      "SELECT value FROM wallet_config WHERE key = 'eth_last_block'"
    );
    const lastBlock = parseInt(lastBlockRes.rows[0]?.value || '0', 10);
    const fromBlock = lastBlock > 0 ? lastBlock + 1 : currentBlock - 100;

    if (fromBlock > currentBlock) return;

    const addressMap = new Map();
    for (const w of wallets) {
      addressMap.set(w.address.toLowerCase(), w);
    }
    const addresses = wallets.map((w) => w.address);

    // Scan blocks for native ETH transfers to our wallets
    await this._scanEthBlocks(fromBlock, currentBlock, addressMap);

    // Check USDC ERC-20 Transfer events
    try {
      const paddedAddresses = addresses.map(
        (a) => '0x' + a.slice(2).toLowerCase().padStart(64, '0')
      );

      const logs = await this.ethProvider.getLogs({
        fromBlock,
        toBlock: currentBlock,
        address: CHAINS.ethereum.usdcContract,
        topics: [ERC20_TRANSFER_TOPIC, null, paddedAddresses],
      });

      for (const log of logs) {
        const toAddr = '0x' + log.topics[2].slice(26).toLowerCase();
        const wallet = addressMap.get(toAddr);
        if (!wallet) continue;

        const amountRaw = BigInt(log.data);
        const amountDecimal = Number(amountRaw) / 10 ** CHAINS.ethereum.usdcDecimals;

        if (amountDecimal >= MIN_DEPOSIT.USDC_ERC20) {
          await this._recordDeposit({
            userId: wallet.user_id,
            walletId: wallet.id,
            chain: 'ethereum',
            asset: 'USDC_ERC20',
            txHash: log.transactionHash,
            amountRaw: amountRaw.toString(),
            amountDecimal,
            confirmations: currentBlock - log.blockNumber,
            requiredConfs: CHAINS.ethereum.requiredConfirmations,
          });
        }
      }
    } catch (err) {
      console.error('USDC ERC-20 log scan failed:', err.message);
    }

    // Update last scanned block
    await this.pool.query(
      "UPDATE wallet_config SET value = $1, updated_at = NOW() WHERE key = 'eth_last_block'",
      [currentBlock.toString()]
    );
  }

  /**
   * Scan a range of blocks for native ETH transfers to our wallet addresses.
   * Uses real transaction hashes — no synthetic keys.
   */
  async _scanEthBlocks(fromBlock, toBlock, addressMap) {
    // Cap range to avoid scanning too many blocks at once
    const maxRange = 500;
    const startBlock = Math.max(fromBlock, toBlock - maxRange + 1);

    for (let blockNum = startBlock; blockNum <= toBlock; blockNum++) {
      try {
        const block = await this.ethProvider.getBlock(blockNum, true);
        if (!block || !block.prefetchedTransactions) continue;

        for (const tx of block.prefetchedTransactions) {
          if (!tx.to || !tx.value) continue;
          const toAddr = tx.to.toLowerCase();
          const wallet = addressMap.get(toAddr);
          if (!wallet) continue;

          const amountDecimal = parseFloat(ethers.formatEther(tx.value));
          if (amountDecimal < MIN_DEPOSIT.ETH) continue;

          await this._recordDeposit({
            userId: wallet.user_id,
            walletId: wallet.id,
            chain: 'ethereum',
            asset: 'ETH',
            txHash: tx.hash,
            amountRaw: tx.value.toString(),
            amountDecimal,
            confirmations: toBlock - blockNum,
            requiredConfs: CHAINS.ethereum.requiredConfirmations,
          });
        }
      } catch (err) {
        console.error(`ETH block scan failed for block ${blockNum}:`, err.message);
      }
    }
  }

  // --- Solana Polling ---

  async _pollSolana() {
    const wallets = await this.walletManager.getWalletAddresses('solana');
    if (wallets.length === 0) return;

    for (const wallet of wallets) {
      try {
        await this._scanSolTransactions(wallet);
      } catch (err) {
        console.error(`SOL check failed for ${wallet.address}:`, err.message);
      }
    }
  }

  /**
   * Fetch recent transaction signatures for a Solana wallet and process
   * any incoming native SOL or SPL USDC transfers.
   * Tracks last processed signature per wallet to avoid re-processing.
   */
  async _scanSolTransactions(wallet) {
    const pubkey = new PublicKey(wallet.address);

    // Get last processed signature for this wallet
    const configKey = `sol_last_sig_${wallet.address}`;
    const lastSigRes = await this.pool.query(
      'SELECT value FROM wallet_config WHERE key = $1',
      [configKey]
    );
    const lastSignature = lastSigRes.rows[0]?.value || undefined;

    // Fetch new signatures since last processed
    const opts = { limit: 100 };
    if (lastSignature) opts.until = lastSignature;

    const signatures = await this.solConnection.getSignaturesForAddress(pubkey, opts);

    if (signatures.length === 0) return;

    // Process oldest-first so we can update the cursor correctly
    const orderedSigs = [...signatures].reverse();

    for (const sigInfo of orderedSigs) {
      if (sigInfo.err) continue; // skip failed txs

      try {
        const tx = await this.solConnection.getParsedTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
        });
        if (!tx || !tx.meta) continue;

        // Check for native SOL transfers to this wallet
        await this._extractSolTransfers(wallet, tx, sigInfo.signature);

        // Check for SPL token (USDC) transfers to this wallet
        await this._extractSplTransfers(wallet, tx, sigInfo.signature);
      } catch (err) {
        console.error(`Failed to process SOL tx ${sigInfo.signature}:`, err.message);
      }
    }

    // Update cursor to most recent signature (first in original order)
    const newestSig = signatures[0].signature;
    await this.pool.query(
      `INSERT INTO wallet_config (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [configKey, newestSig]
    );
  }

  /**
   * Extract native SOL transfers from a parsed transaction.
   * Compares pre/post balances for the wallet's account index.
   */
  async _extractSolTransfers(wallet, tx, signature) {
    const accountKeys = tx.transaction.message.accountKeys.map((k) =>
      typeof k === 'string' ? k : k.pubkey?.toBase58?.() || k.pubkey || k.toString()
    );

    const walletIndex = accountKeys.indexOf(wallet.address);
    if (walletIndex === -1) return;

    const preBal = tx.meta.preBalances[walletIndex];
    const postBal = tx.meta.postBalances[walletIndex];
    const diff = postBal - preBal;

    if (diff <= 0) return; // outgoing or no change

    const amountDecimal = diff / 10 ** CHAINS.solana.nativeDecimals;
    if (amountDecimal < MIN_DEPOSIT.SOL) return;

    await this._recordDeposit({
      userId: wallet.user_id,
      walletId: wallet.id,
      chain: 'solana',
      asset: 'SOL',
      txHash: signature,
      amountRaw: diff.toString(),
      amountDecimal,
      confirmations: CHAINS.solana.requiredConfirmations, // Solana finality is fast
      requiredConfs: CHAINS.solana.requiredConfirmations,
    });
  }

  /**
   * Extract SPL USDC transfers from a parsed transaction.
   */
  async _extractSplTransfers(wallet, tx, signature) {
    const preTokenBalances = tx.meta.preTokenBalances || [];
    const postTokenBalances = tx.meta.postTokenBalances || [];

    // Find USDC token balance changes for this wallet (owner)
    const usdcMint = CHAINS.solana.usdcMint;

    for (const postBal of postTokenBalances) {
      if (postBal.mint !== usdcMint) continue;
      if (postBal.owner !== wallet.address) continue;

      const postAmount = parseFloat(postBal.uiTokenAmount?.uiAmountString || '0');
      const preBal = preTokenBalances.find(
        (p) => p.accountIndex === postBal.accountIndex && p.mint === usdcMint
      );
      const preAmount = preBal ? parseFloat(preBal.uiTokenAmount?.uiAmountString || '0') : 0;

      const diff = postAmount - preAmount;
      if (diff < MIN_DEPOSIT.USDC_SPL) continue;

      const amountRaw = BigInt(Math.round(diff * 10 ** CHAINS.solana.usdcDecimals));

      await this._recordDeposit({
        userId: wallet.user_id,
        walletId: wallet.id,
        chain: 'solana',
        asset: 'USDC_SPL',
        txHash: `${signature}_usdc`,
        amountRaw: amountRaw.toString(),
        amountDecimal: diff,
        confirmations: CHAINS.solana.requiredConfirmations,
        requiredConfs: CHAINS.solana.requiredConfirmations,
      });
    }
  }

  // --- Confirmation Processing ---

  async _processConfirmations() {
    // Get pending/confirmed deposits that haven't been credited yet
    const pending = await this.pool.query(
      "SELECT * FROM deposits WHERE status IN ('pending', 'confirmed') ORDER BY detected_at"
    );

    for (const deposit of pending.rows) {
      try {
        let currentConfs = deposit.confirmations;

        if (deposit.chain === 'ethereum' && deposit.tx_hash.startsWith('0x')) {
          const receipt = await this.ethProvider.getTransactionReceipt(deposit.tx_hash);
          if (receipt) {
            const currentBlock = await this.ethProvider.getBlockNumber();
            currentConfs = currentBlock - receipt.blockNumber;
          }
        } else if (deposit.chain === 'solana') {
          // Solana transactions are final after ~32 confirmations (near-instant)
          currentConfs = deposit.required_confs;
        }

        if (currentConfs >= deposit.required_confs && deposit.status !== 'credited') {
          await this._creditDeposit(deposit, currentConfs);
        } else if (currentConfs > deposit.confirmations) {
          await this.pool.query(
            "UPDATE deposits SET confirmations = $1, status = 'confirmed' WHERE id = $2",
            [currentConfs, deposit.id]
          );
        }
      } catch (err) {
        console.error(`Confirmation check failed for deposit ${deposit.id}:`, err.message);
      }
    }
  }

  // --- Helpers ---

  async _recordDeposit({ userId, walletId, chain, asset, txHash, amountRaw, amountDecimal, confirmations, requiredConfs }) {
    // Check for duplicate tx_hash
    const exists = await this.pool.query(
      'SELECT id FROM deposits WHERE tx_hash = $1',
      [txHash]
    );
    if (exists.rows.length > 0) return;

    // Get USD value
    const price = await this.priceService.getPrice(asset);
    const usdValue = amountDecimal * price;
    const tokensCredited = usdValue; // 1:1 USD to tokens

    await this.pool.query(
      `INSERT INTO deposits (user_id, wallet_id, chain, asset, tx_hash, amount_raw, amount_decimal, usd_value, tokens_credited, confirmations, required_confs)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [userId, walletId, chain, asset, txHash, amountRaw, amountDecimal, usdValue, tokensCredited, confirmations, requiredConfs]
    );

    console.log(`Deposit detected: ${amountDecimal} ${asset} for user ${userId} (tx: ${txHash})`);

    // If already enough confirmations, credit immediately
    if (confirmations >= requiredConfs) {
      const depositRes = await this.pool.query('SELECT * FROM deposits WHERE tx_hash = $1', [txHash]);
      if (depositRes.rows[0]) {
        await this._creditDeposit(depositRes.rows[0], confirmations);
      }
    }
  }

  async _creditDeposit(deposit, confirmations) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Atomically claim this deposit — only credit if still pending/confirmed
      const claim = await client.query(
        "UPDATE deposits SET status = 'credited', confirmations = $1, confirmed_at = NOW(), credited_at = NOW() WHERE id = $2 AND status IN ('pending', 'confirmed') RETURNING id",
        [confirmations, deposit.id]
      );
      if (claim.rows.length === 0) {
        // Already credited or failed — skip
        await client.query('ROLLBACK');
        return;
      }

      // Credit user balance
      const balRes = await client.query(
        'UPDATE users SET token_balance = token_balance + $1 WHERE id = $2 RETURNING token_balance',
        [deposit.tokens_credited, deposit.user_id]
      );
      const newBalance = balRes.rows[0].token_balance;

      // Ledger entry
      await client.query(
        `INSERT INTO ledger (user_id, type, amount, balance_after, reference_type, reference_id, description)
         VALUES ($1, 'deposit', $2, $3, 'deposit', $4, $5)`,
        [deposit.user_id, deposit.tokens_credited, newBalance, deposit.id, `${deposit.amount_decimal} ${deposit.asset} deposit`]
      );

      await client.query('COMMIT');
      console.log(`Deposit credited: ${deposit.tokens_credited} tokens for user ${deposit.user_id}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Failed to credit deposit ${deposit.id}:`, err.message);
    } finally {
      client.release();
    }
  }
}
