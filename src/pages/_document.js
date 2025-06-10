import Document, { Html, Head, Main, NextScript } from 'next/document';

class MyDocument extends Document {
  render() {
    return (
      <Html lang="en">
        <Head>
          <meta charSet="utf-8" />
          <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          
          {/* Add connection back for app functionality */}
          <link rel="preconnect" href="https://arweave.net" crossOrigin="anonymous" />
          <link rel="preconnect" href="https://firestore.googleapis.com" crossOrigin="anonymous" />
        </Head>
        <Main />
        <NextScript />
      </Html>
    );
  }
}

export default MyDocument; 