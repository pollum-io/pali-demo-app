import React from 'react';

declare global {
  interface Window {
    pali: Readonly<any>;
  }
}

const App = () => {
  const connectWallet = async () => {
    if (window.pali) {
      await window.pali.enable();
    }

    console.error('pali provider not found.');
  };

  const changeAccount = async () => {
    if (window.pali) {
      await window.pali.request('changeAccount');
    }

    console.error('pali provider not found.');
  };

  return (
    <div>
      <p className="text-red">Pali demo app</p>

      <button onClick={connectWallet}>connect wallet</button>
      <button onClick={changeAccount}>change account</button>
    </div>
  );
};

export default App;
