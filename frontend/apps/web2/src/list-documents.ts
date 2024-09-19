import {toPlainMessage} from "@bufbuild/protobuf";
import {queryClient} from "./client";

export async function listDocuments(account: string, currentPath: string = "") {
  let res = await queryClient.documents.listDocuments({account});

  const docs = res.documents
    .filter((doc) => doc.path !== "")
    .map(toPlainMessage)
    .filter((doc) => {
      if (currentPath == "") {
        // is the root document, return only root paths
        let path = doc.path.slice(1).split("/");
        return path.length == 1;
      } else {
        return doc.path.startsWith(currentPath);
      }
    });
  // .map((doc) => {

  // })
  // .filter((doc) => doc.path.length == 1);

  return docs;
  // return docs.documents.filter((item) => item.path != "");
}
