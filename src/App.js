import logo from './logo.svg';
import './App.css'; 
import { useEffect, useState, useCallback } from "react";
function App() {
 
  
  const handleConnectWallet = async(event) =>{
    event.preventDefault();
    console.log("Checking if wallet is connected")
    if (controller) {
        await controller.connectWallet()
        setIsConnected(true);
        console.log("... connected")
    };
  } 


  const handleMakeSomething = async(result) => {
    await controller.getConnectedAccount();
    // YOUR TEST CODE HERE:
    var items
    items = {amount: 3, assetGuid: '1524267225'}
    result = await controller.handleIssueSPT(items)
    console.log('token issued')

    // EXAMPLE OF PROMISE CHAIN
    //if (controller) {
    //    controller.connectWallet().then( async (result) => {
    //        console.log(".. connected");
    //        result = await controller.getConnectedAccount();
    //        console.log('result keys' + Object.keys(result))
    //    });
    //}
    
    //SENDING TOKEN
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
        console.log("connected")
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
        Connect wallet
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
