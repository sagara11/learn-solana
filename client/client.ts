const {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
  AddressLookupTableProgram,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  TransactionMessage,
  VersionedTransaction,
} = require("@solana/web3.js");

const intitialize = async () => {
  const connection = new Connection("http://127.0.0.1:8899");
  const slot = await connection.getSlot();
  let lastestBlockHash = await connection
    .getLatestBlockhash()
    .then((res) => res.blockhash);

  let minRent = await connection.getMinimumBalanceForRentExemption(0);

  // Assumption:
  // `payer` is a valid `Keypair` with enough SOL to pay for the execution
  let payer = Keypair.generate();
  let toAccount = Keypair.generate();

  console.log(
    "payer:" + payer.publicKey.toBase58(),
    "toAccount:" + toAccount.publicKey.toBase58()
  );

  console.log("Sending money ...");
  const signature = await connection.requestAirdrop(
    payer.publicKey,
    LAMPORTS_PER_SOL
  );
  await connection.confirmTransaction(signature);

  return { connection, slot, lastestBlockHash, payer, toAccount, minRent };
};

const creat_ALUT = async (payer, slot, connection) => {
  const [lookupTableInst, lookupTableAddress] =
    AddressLookupTableProgram.createLookupTable({
      authority: payer.publicKey,
      payer: payer.publicKey,
      recentSlot: slot - 1,
    });

  let lastestBlockHash = await connection
    .getLatestBlockhash()
    .then((res) => res.blockhash);

  console.log("lookup table address:", lookupTableAddress.toBase58());

  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: lastestBlockHash,
    instructions: [lookupTableInst],
  }).compileToV0Message();

  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([payer]);
  const tx = await connection.sendTransaction(transaction);

  console.log(`Created lookup table: ${tx}`);
  await connection.confirmTransaction({
    blockhash: lastestBlockHash.blockhash,
    signature: tx,
  });

  return { lookupTableAddress };
};

const extend_lookup_table = async (
  payer,
  lookupTableAddress,
  toAccount,
  connection
) => {
  const extendInstruction = AddressLookupTableProgram.extendLookupTable({
    payer: payer.publicKey,
    authority: payer.publicKey,
    lookupTable: lookupTableAddress,
    addresses: [payer.publicKey, SystemProgram.programId, toAccount.publicKey],
  });

  let lastestBlockHash = await connection
    .getLatestBlockhash()
    .then((res) => res.blockhash);

  const extensionMessageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: lastestBlockHash,
    instructions: [extendInstruction],
  }).compileToV0Message();

  const extensionTransactionV0 = new VersionedTransaction(extensionMessageV0);
  extensionTransactionV0.sign([payer]);
  const tx = await connection.sendTransaction(extensionTransactionV0);

  await connection.confirmTransaction({
    blockhash: lastestBlockHash.blockhash,
    signature: tx,
  });
};

const fetch_ALUT = async (lookupTableAddress, connection) => {
  // get the table from the cluster
  const lookupTableAccount = (
    await connection.getAddressLookupTable(lookupTableAddress)
  ).value;

  // `lookupTableAccount` will now be a `AddressLookupTableAccount` object
  console.log(lookupTableAccount);
  console.log("Table address from cluster:", lookupTableAccount.key.toBase58());

  // loop through and parse all the addresses stored in the table
  for (let i = 0; i < lookupTableAccount.state.addresses.length; i++) {
    const address = lookupTableAccount.state.addresses[i];
    console.log(i, address.toBase58());
  }

  return { lookupTableAccount };
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const transfer = async (
  minRent,
  payer,
  toAccount,
  lookupTableAccount,
  connection
) => {
  const instructions = [
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: toAccount.publicKey,
      lamports: minRent,
    }),
  ];

  let lastestBlockHash = await connection
    .getLatestBlockhash()
    .then((res) => res.blockhash);

  // create v0 compatible message
  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: lastestBlockHash,
    instructions,
  }).compileToV0Message([lookupTableAccount]);

  console.log(instructions[0].keys);
  console.log(messageV0);
  console.log(messageV0.addressTableLookups[0].writableIndexes);
  console.log(messageV0.compiledInstructions[0].accountKeyIndexes);
  console.log(lookupTableAccount);

  // make a versioned transaction
  const transactionV0 = new VersionedTransaction(messageV0);
  transactionV0.sign([payer]);

  await delay(1000);

  const txid = await sendAndConfirmTransaction(connection, transactionV0);

  console.log(txid);
};

const main = async () => {
  const { connection, slot, lastestBlockHash, payer, toAccount, minRent } =
    await intitialize();
  const { lookupTableAddress } = await creat_ALUT(payer, slot, connection);
  // ---------------------------------------------------------------------------
  // add addresses to the `lookupTableAddress` table via an `extend` instruction
  await extend_lookup_table(payer, lookupTableAddress, toAccount, connection);

  const { lookupTableAccount } = await fetch_ALUT(
    lookupTableAddress,
    connection
  );

  await transfer(minRent, payer, toAccount, lookupTableAccount, connection);
};

main();
