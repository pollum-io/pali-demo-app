import logo from './logo.svg';
import './App.css'; 
import { useEffect, useState, useCallback } from "react";
function App() {
 
  
  const handleConnectWallet = async(event) =>{
    event.preventDefault();
    console.log("Checking if wallet is connected")
    if (controller) {
        var result;
        result = await controller.getConnectedAccount()
        if (result == null){
            console.log('Wallet is not connected')
            setIsConnected(false)
            console.log('conecting wallet..')
            await controller.connectWallet()
            setIsConnected(true);
            console.log("... connected")
        } else {
            setIsConnected(true)
            console.log('Wallet is already connected')
        }
    }
  }


  const handleMakeSomething = async(result) => {

    // YOUR TEST CODE HERE:

    // CREATE TOKEN
    //var input
    //input = { precision: 2, symbol: 'Coffees', amount: 10, 
    //            description: 'Not for lactose intolerants', 
    //            receiver: 'tsys1q0t9l60hxql6f4f7m47j682m7ncrd5xs4yz00dc'}
    //await controller.handleCreateToken(input)
    //console.log('creating token, transaction is underway')
    
    // ISSUE SPT
    //var input
    //input = { amount: 2, assetGuid: '4081065178'}
    //result = await controller.handleIssueSPT(input)
    //console.log('Issuing token')

    // GET DATA ASSET() 
    //result = await controller.getDataAsset('4081065178')
    //console.log('Result symbol: ' + Object.values(result)[2])

   // ISSUE NFT
    //result = await controller.handleIssueNFT({amount: 1, assetGuid: '3591320275'})
    //console.log("...creating nft")
    //console.log('Results: ' + result)
    
    // EXAMPLE OF PROMISE CHAIN
    //if (controller) {
    //    controller.connectWallet().then( async (result) => {
    //        console.log(".. connected");
    //        result = await controller.getConnectedAccount();
    //        console.log('result keys' + Object.keys(result))
    //    });
    //}
    
    //SENDING TOKENS
    //var token, input
    //token = {assetGuid: "2681611140", balance: 100000000, decimals: 2, symbol: "Coffees", type: "SPTAllocated"}
    //input = {sender: "tsys1qvpjfee87n83d4kfhdwcw3fq76mteh92e4vdr8v", receiver: "tsys1q4g67h0rx8j7pzlxfqystemeclkp3shuh2np065", amount: 13, fee: 0.0001, token: token, isToken: true, rbf: true}
    //if (controller) {
    //    result = await controller.handleSendToken(input)
    //}


  }
  
  const [isInstalled, setIsInstalled] = useState(false);
  const [canConnect, setCanConnect] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [balance, setBalance] = useState(0);
  const [controller, setController] = useState();
  const [connectedAccount, setConnectedAccount] = useState({});
  const [connectedAccountAddress, setConnectedAccountAddress] = useState('');
  const [amount, setAmount] = useState(0);
  const [fee, setFee] = useState(0.00001);
  const [toAddress, setToAddress] = useState('');
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [checked, setChecked] = useState(false);




  useEffect(() => {
    const callback = async (event) => {
      if (event.detail.SyscoinInstalled) {
        setIsInstalled(true);
        console.log("Wallet installed = true")
        if (event.detail.ConnectionsController) {
          setController(window.ConnectionsController);
          
          return;
        }

        return;
      }
      console.log("Not installed")
      setIsInstalled(false);

      window.removeEventListener('SyscoinStatus', callback);
    }
    console.log("Adding wallet callback")
    window.addEventListener('SyscoinStatus', callback);
  }, []);
  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        {isInstalled ? 
      <button
      onClick={handleConnectWallet}
      >
        Connect wallet / Enable Testing
      </button>
      : 
      null  
      }
      
      
      {isConnected ? 
    <button
    onClick={handleMakeSomething}
    >
      Test Wallet
    </button>
    : 
    null  
    }
      
      </header>
      
    </div>
  );

}

export default App;
