// src/components/Auth0ProviderWithConfig.jsx
import { Auth0Provider } from '@auth0/auth0-react';

export function Auth0ProviderWithConfig({ children }) {
  return (
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        scope: 'openid profile email'
      }}
      cacheLocation="localstorage"
    >
      {children}
    </Auth0Provider>
  );
}