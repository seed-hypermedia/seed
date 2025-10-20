import dotenv from 'dotenv'
import {join} from 'path'

// we are using dotenv because it allows us to keep secrets by saving the `.env` file locally and distributing them privately.
const dotenvPath = join(process.cwd(), '.env')
dotenv.config({path: dotenvPath})

export function initDotenvConfig() {
  // this function is called just to make sure the import organizer doesn't remove the import
}
