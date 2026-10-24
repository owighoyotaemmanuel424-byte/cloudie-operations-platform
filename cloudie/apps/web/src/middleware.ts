import { NextResponse } from "next/server";
import { auth } from "./auth";

export default auth((request) => {
  const path = request.nextUrl.pathname;
  const isProtected = path.startsWith("/app") || path.startsWith("/admin");
  const user = request.auth?.user;
  if (isProtected && !user) return NextResponse.redirect(new URL("/signin", request.url));
  if (path.startsWith("/admin") && user?.role !== "ADMIN") return NextResponse.redirect(new URL("/app", request.url));
  return NextResponse.next();
});
export const config = { matcher: ["/app/:path*", "/admin/:path*"] };
