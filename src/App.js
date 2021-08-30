import { useEffect, useState } from 'react';

const WalletMethods = () => {
  const [controller, setController] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [connectedAccount, setConnectedAccount] = useState(null);

  useEffect(() => {
    const callback = async (event) => {
      if (event.detail.SyscoinInstalled) {
        setIsInstalled(true);
        console.log('syscoin is installed');

        if (event.detail.ConnectionsController) {
          setController(window.ConnectionsController);
          console.log('controller is set');

          return;
        }

        return;
      }

      window.removeEventListener('SyscoinStatus', callback);
    }

    console.log('checking syscoin status');

    window.addEventListener('SyscoinStatus', callback);
  }, []);

  useEffect(() => {
    if (controller) {
      controller.getConnectedAccount().then((account) => {
        setConnectedAccount(account);
      });
    }
  }, [
    controller
  ]);

  const handleConnectWallet = async (event) => {
    event.preventDefault();

    if (controller) {
      await controller.connectWallet();
    }
  }

  const handleMakeSomething = async () => {
    if (controller && connectedAccount) {
      console.log('You can call any of the functions listed below to start testing Pali Wallet :)')

      // your test code here

      /**
       * CONNECT WALLET
       * 
       * await controller.connectWallet();
       */

      /**
       * GET CHANGE ADDRESS
       * 
       * await controller.getChangeAddress();
       */

      /**
       * GET CONNECTED ACCOUNT
       * 
       * await controller.getConnectedAccount();
       */

      /**
       * GET CONNECTED ACCOUNT XPUB
       * 
       * await controller.getConnectedAccountXpub();
       */

      /**
       * GET HOLDINGS FROM CONNECTED ACCOUNT
       * 
       * await controller.getHoldingsData();
       */

      /**
       * GET CONNECTED ACCOUNT MINTED TOKENS
       * 
       * await controller.getUserMintedTokens();
       */

      /**
       * GET WALLET STATE
       * 
       * await controller.getWalletState();
       */

      /**
       * IS LOCKED
       * 
       * await controller.isLocked();
       */

      /**
       * IS NFT
       * 
       * await controller.isNFT('482138944');
       */

      /**
       * IS VALID SYS ADDRESS
       * 
       * await controller.isValidSYSAddress('tsys1qegrn5mazdxu3emy2yvj7yl6pq3vnfg4d2nupfr');
       */

      /**
       * ON WALLET UPDATE
       * 
       * const setup = async () => {
       *   if (controller) {
       *     console.log('setup', await controller.getConnectedAccount());
       *   }
       * }
       * 
       * await controller.onWalletUpdate(setup);
       */

      /**
       * GET DATA ASSET
       * 
       * const assetData = await controller.getDataAsset('482138944');
       * 
       * console.log('data for token', assetData);
       */


      // TRANSACTIONS

      /**
       * CREATE TOKEN
       * 
       * await controller.handleCreateToken({
       *   precision: 2,
       *   symbol: 'Coffees',
       *   maxsupply: 10,
       *   description: 'Not for lactose intolerants', 
       *   receiver: connectedAccount.address.main
       * });
       * 
       * console.log('creating token - your transaction is underway');
       */

      /**
       * ISSUE SPT
       * 
       * await controller.handleIssueSPT({ amount: 1, assetGuid: '765909474' });
       * 
       * console.log('issuing token - your transaction is underway');
       */

      /**
       * CREATE NFT
       * 
       * await controller.handleCreateNFT({
       *  symbol: 'nfttest',
       *  precision: 1,
       *  issuer: connectedAccount.main.address,
       *  description: 'description for test nft'
       * });
       */

      /**
       * ISSUE NFT
       * 
       * await controller.handleIssueNFT({ assetGuid: '', amount: 5 });
       */

      /**
       * TRANSFER OWNERSHIP
       * 
       * await controller.handleTransferOwnership({ newOwner: connectedAccount.address.main, assetGuid: '4239303503' });
       */

      /**
       * UPDATE ASSET
       * 
       * await controller.handleUpdateAsset({ description: 'new description', assetGuid: '4239303503' })
       */

      /**
       * SENDING TOKENS
       * 
       * await controller.handleSendToken({
       *  sender: "tsys1qvpjfee87n83d4kfhdwcw3fq76mteh92e4vdr8v",
       *  receiver: "tsys1q4g67h0rx8j7pzlxfqystemeclkp3shuh2np065",
       *  amount: 5,
       *  token: {
       *    assetGuid: "2681611140",
       *    balance: 100000000,
       *    decimals: 2,
       *    symbol: "Coffees",
       *    type: "SPTAllocated"
       *  },
       *  rbf: true,
       *  fee: 0.00001
       * })
       */

      // SIGN FUNCTIONS

      // to test these functions you need to make the request below and run the server using yarn server

      /**
       * const getSerializedPSBT = async () => {
       *   const sysChangeAddress = await controller.getChangeAddress(); // gets change address
       *   const xpub = await controller.getConnectedAccountXpub(); // gets Xpub key
       *   const response = await fetch(`http://localhost:8080/sendAsset?xpub=${xpub}&changeAddress=${sysChangeAddress}`);
       *   const serializedResponse = await response.json();
       * 
       *   return serializedResponse;
       * }
       */

      /**
       * SIGN AND SEND
       * 
       * const signedPSBT = await controller.signAndSend(await getSerializedPSBT());
       * 
       * console.log('signed psbt', signedPSBT);
       */

      /**
       * SIGN PSBT
       * 
       * const signedPSBT = await controller.signPSBT(await getSerializedPSBT());
       * 
       * console.log('signed psbt', signedPSBT);
       */
    }
  }

  return (
    <div className="app">
      <h2 className="app__title">Pali Wallet demo</h2>
      <div className="app__actions">
        <button
          className="app__button"
          disabled={!isInstalled}
          onClick={handleConnectWallet}
        >
          Connect/Change wallet
        </button>

        <button className="app__button" onClick={handleMakeSomething} disabled={!controller || !connectedAccount}>
          Make something
        </button>
      </div>
    </div>
  );
}

export default WalletMethods;
