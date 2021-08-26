const express = require('express');
const app = express();
const sjs = require('syscoinjs-lib')
var cors = require('cors');
const backendURL = 'https://blockbook-dev.elint.services/' 
const syscoinjs = new sjs.SyscoinJSLib(null, backendURL, sjs.utils.syscoinNetworks.testnet)
app.use(cors());

app.get('/', function (req, res) {
 return res.send('Hello world');
});

app.get('/sendAsset',function(req,res){
    //start here
    let xpub = req.query.xpub 
    
    let changeAddress = req.query.changeAddress
    sendAssetUnsigned(xpub,changeAddress).then(respo=>{
    return res.send(sjs.utils.exportPsbtToJson(respo.psbt,respo.assets))
});
   
});



const sendAssetUnsigned = async (xpub, sysChangeAddress) => {

  console.log(xpub)
      console.log(sysChangeAddress)
      const feeRate = new sjs.utils.BN(10)
  // set to false for ZDAG, true disables it but it is replaceable by bumping the fee
      const txOpts = { rbf: false }
      const assetguid = '250649253'
      // if assets need change sent, set this address. null to let HDSigner find a new address for you
      const assetMap = new Map([
        [assetguid, { changeAddress: sysChangeAddress, outputs: [{ value: new sjs.utils.BN(5000), address: 'tsys1q5cs9vzt3tev64kylaqjtgw0cp87qsy3sau927n' }] }]
      ])
      // if SYS need change sent, set this address. null to let HDSigner find a new address for you
      const res = await syscoinjs.assetAllocationSend(txOpts, assetMap, sysChangeAddress, feeRate,xpub)
      if (!res) {
        console.log('Could not create transaction, not enough funds?')
      }
      console.log(res)
  
    
    return res
    
  }

 

app.listen(process.env.PORT || 8080);