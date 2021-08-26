import logo from './logo.svg';
import './App.css'; 
import { useEffect, useState, useCallback } from "react";
const sysjs = require('syscoinjs-lib')
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

    // accessing the connected account
    if (window.ConnectionsController) {
      const getConnectedAccount = await window.ConnectionsController.getConnectedAccount() 
      console.log('printing connected account')
        console.log(getConnectedAccount)
      // if account is connected:
      if(getConnectedAccount !== undefined){
        
      const sysChangeAddress = await window.ConnectionsController.getChangeAddress(); // gets change address
      const xpub = await window.ConnectionsController.getConnectedAccountXpub(); // gets Xpub key
      console.log(xpub)
      console.log(sysChangeAddress)
      // sends xpub and change address to the syscoin-libjs and returns a serialized answer due to hashing of information on blockchain
      // Due to some issues with React, this step needs a server to be runing, check documentation on the Git page for how to do this
      const resp = await fetch('http://localhost:8080/sendAsset?xpub='+xpub+'&changeAddress='+sysChangeAddress)
      const serializedResp = await resp.json()
      console.log(serializedResp)
      //this is just to check if serialized output is ok, not really necessary
      //------------------------------------------------------------------------------
      const {psbt, assets} = sysjs.utils.importPsbtFromJson(serializedResp);
      console.log(psbt)
      console.log(assets)
      //------------------------------------------------------------------------------
      // signs the transaction and sends
      const output = await window.ConnectionsController.signTransaction(serializedResp);
      console.log(output)
      }
      else{
        alert('Connect to some account first') 
      }
    }
    else{
      alert('Install Pali Wallet')
    }
    
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

      window.removeEventListener('SyscoinStatus', callback);
    }
    console.log("Adding wallet callback")
    window.addEventListener('SyscoinStatus', callback);

  }, []);
  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
      <button
      onClick={handleConnectWallet}
      >
        Connect/Change wallet
      </button>
      

      {window.ConnectionsController ? 
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
