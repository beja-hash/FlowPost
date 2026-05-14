import { UserStatus } from "@prisma/client";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      status: UserStatus;
    };
  }

  interface User {
    status: UserStatus;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    status?: UserStatus;
  }
}
