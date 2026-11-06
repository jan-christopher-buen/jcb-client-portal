import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { App } from './App.js'
import './tokens.css'
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/sign-in" replace />} />
        <Route path="/sign-in" element={<App />} />
        <Route
          path="*"
          element={
            <main className="missing">
              <h1>Page unavailable</h1>
              <p>This page is not part of the local foundation.</p>
              <a href="/sign-in">Return to sign in</a>
            </main>
          }
        />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)
