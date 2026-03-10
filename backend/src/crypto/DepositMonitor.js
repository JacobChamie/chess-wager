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

    // Check native ETH balances
    for (const wallet of wallets) {
      try {
        const balance = await this.ethProvider.getBalance(wallet.address);
        if (balance > 0n) {
          const amountDecimal = parseFloat(ethers.formatEther(balance));
          if (amountDecimal >= MIN_DEPOSIT.ETH) {
            // Use wallet address + amount as stable key to prevent duplicate detection
            await this._recordDeposit({
              userId: wallet.user_id,
              walletId: wallet.id,
              chain: 'ethereum',
              asset: 'ETH',
              txHash: `eth_native_${wallet.address}_${balance.toString()}`,
              amountRaw: balance.toString(),
              amountDecimal,
              confirmations: currentBlock - fromBlock,
              requiredConfs: CHAINS.ethereum.requiredConfirmations,
            });
          }
        }
      } catch (err) {
        console.error(`ETH balance check failed for ${wallet.address}:`, err.message);
      }
    }

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

  // --- Solana Polling ---

  async _pollSolana() {
    const wallets = await this.walletManager.getWalletAddresses('solana');
    if (wallets.length === 0) return;

    for (const wallet of wallets) {
      try {
        // Check native SOL balance
        const pubkey = new PublicKey(wallet.address);
        const balance = await this.solConnection.getBalance(pubkey);
        if (balance > 0) {
          const amountDecimal = balance / 10 ** CHAINS.solana.nativeDecimals;
          if (amountDecimal >= MIN_DEPOSIT.SOL) {
            // Use wallet address + amount as stable key to prevent duplicate detection
            await this._recordDeposit({
              userId: wallet.user_id,
              walletId: wallet.id,
              chain: 'solana',
              asset: 'SOL',
              txHash: `sol_native_${wallet.address}_${balance.toString()}`,
              amountRaw: balance.toString(),
              amountDecimal,
              confirmations: 32, // devnet/mainnet SOL confirms near-instantly
              requiredConfs: CHAINS.solana.requiredConfirmations,
            });
          }
        }

        // Check USDC SPL token accounts
        const usdcMint = new PublicKey(CHAINS.solana.usdcMint);
        const tokenAccounts = await this.solConnection.getTokenAccountsByOwner(pubkey, {
          mint: usdcMint,
        });

        for (const { account } of tokenAccounts.value) {
          // Parse token account data (simplified — amount is at offset 64, 8 bytes LE)
          const data = account.data;
          const amountRaw = data.readBigUInt64LE(64);
          const amountDecimal = Number(amountRaw) / 10 ** CHAINS.solana.usdcDecimals;

          if (amountDecimal >= MIN_DEPOSIT.USDC_SPL) {
            await this._recordDeposit({
              userId: wallet.user_id,
              walletId: wallet.id,
              chain: 'solana',
              asset: 'USDC_SPL',
              txHash: `sol_usdc_${wallet.address}_${amountRaw.toString()}`,
              amountRaw: amountRaw.toString(),
              amountDecimal,
              confirmations: 32,
              requiredConfs: CHAINS.solana.requiredConfirmations,
            });
          }
        }
      } catch (err) {
        console.error(`SOL check failed for ${wallet.address}:`, err.message);
      }
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
          // Native balance checks are inherently confirmed on Solana
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
