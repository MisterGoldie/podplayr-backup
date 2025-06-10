import NextAuth from "next-auth"

const handler = NextAuth({
  providers: [
    // your providers...
  ],
  // The secret will be read from the NEXTAUTH_SECRET environment variable
  secret: process.env.NEXTAUTH_SECRET,
})

export { handler as GET, handler as POST }