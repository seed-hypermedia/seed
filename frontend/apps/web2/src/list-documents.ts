import {queryClient} from "./client";

export async function listDocuments(account: string) {
  let docs = await queryClient.documents.listDocuments({account});
  return docs.documents.filter((item) => item.path != "");
}
