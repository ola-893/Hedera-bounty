import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './styles.css'
import { WalletProvider } from './contexts/WalletContext'
import { AllWalletsProvider } from './services/wallets/AllWalletsProvider'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WalletProvider>
      <AllWalletsProvider>
        <App />
      </AllWalletsProvider>
    </WalletProvider>
  </React.StrictMode>,
)
