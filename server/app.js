const express = require('express');
const app = express();
const sjs = require('syscoinjs-lib');
var cors = require('cors');
const backendURL = 'https://blockbook-dev.elint.services/';
const syscoinjs = new sjs.SyscoinJSLib(null, backendURL, sjs.utils.syscoinNetworks.testnet);

app.use(cors());

app.get('/', function (req, res) {
  return res.send('hello world :)');
});

const sendAssetUnsigned = async (xpub, sysChangeAddress) => {
  const feeRate = new sjs.utils.BN(10);
  const txOpts = { rbf: false };
  const assetguid = '250649253';
  const assetMap = new Map([
    [assetguid, { changeAddress: sysChangeAddress, outputs: [{ value: new sjs.utils.BN(5000), address: null }] }]
  ]);
  const response = await syscoinjs.assetAllocationSend(txOpts, assetMap, sysChangeAddress, feeRate, xpub);

  if (!response) {
    console.log('Could not create transaction, not enough funds?')
  }

  return response;
}

app.get('/sendAsset', function (req, res) {
  const { xpub, changeAddress } = req.query;

  sendAssetUnsigned(xpub, changeAddress).then((response) => {
    return res.send(sjs.utils.exportPsbtToJson(response.psbt, response.assets));
  });
});

app.listen(process.env.PORT || 8080);
console.log('server is running on port 8080');