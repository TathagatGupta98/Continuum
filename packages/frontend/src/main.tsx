import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SuiClientProvider, WalletProvider } from '@mysten/dapp-kit'
import '@mysten/dapp-kit/dist/index.css'

import { networkConfig, SUI_NETWORK } from '@/config/sui'
import { connectSocket } from '@/lib/socket'
import { ThemeProvider } from '@/components/ThemeProvider'
import { useLiveRefetch } from '@/hooks/useLiveRefetch'
import App from './App'
import '@/styles/globals.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
})

function Root() {
  useEffect(() => {
    connectSocket()
  }, [])
  useLiveRefetch()
  return <App />
}

const router = createBrowserRouter([
  {
    path: '*',
    element: <Root />,
  },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={SUI_NETWORK}>
        <WalletProvider autoConnect>
          <ThemeProvider>
            <RouterProvider router={router} />
          </ThemeProvider>
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
