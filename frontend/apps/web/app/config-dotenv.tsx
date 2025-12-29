import dotenv from "dotenv";
import { join } from "path";

const dotenvPath = join(process.cwd(), ".env");

dotenv.config({
  path: dotenvPath,
});

export default function configDotenv() {
  console.log("Configuring dotenv file: ", dotenvPath);
}
