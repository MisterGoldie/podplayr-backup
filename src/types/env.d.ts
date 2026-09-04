declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_ALCHEMY_API_KEY: string;
    NEXT_PUBLIC_NEYNAR_API_KEY: string;
    NEXT_PUBLIC_HOST: string;
    NEXT_PUBLIC_NGROK_URL: string;
    NEXT_PUBLIC_URL: string;
    KV_REST_API_URL?: string;
    KV_REST_API_TOKEN?: string;
    NEXT_PUBLIC_FIREBASE_API_KEY: string;
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: string;
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: string;
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: string;
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: string;
    NEXT_PUBLIC_FIREBASE_APP_ID: string;
    FIREBASE_PROJECT_ID?: string;
    FIREBASE_CLIENT_EMAIL?: string;
    FIREBASE_PRIVATE_KEY?: string;
    /** Origin that hosts transcoded {id}/480p.mp4 (and optional 720p / HLS). */
    NEXT_PUBLIC_MEDIA_CDN_BASE?: string;
  }
} 