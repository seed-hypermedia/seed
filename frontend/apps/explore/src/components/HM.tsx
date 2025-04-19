import {hmId, HMIDTypeSchema} from "@shm/shared";
import {useParams} from "react-router-dom";
import {useEntity} from "../models";

export default function HM() {
  const {"*": path} = useParams();
  const pathParts = path ? path.split("/") : [];
  const parsedType = HMIDTypeSchema.safeParse(pathParts[0]);
  let type = parsedType.success ? parsedType.data : null;
  let uid = pathParts[1];
  let hmPath = pathParts.slice(2);
  if (!type) {
    type = "d";
    uid = pathParts[0];
    hmPath = pathParts.slice(1);
  }
  const {data, isLoading} = useEntity(hmId(type, uid, {path: hmPath}));
  return (
    <div className="container p-4 mx-auto">
      <h1 className="mb-4 text-2xl font-bold">HM Route</h1>
      <p>Path parts: {JSON.stringify(pathParts)}</p>
      <p>Type: {type}</p>
      <p>UID: {uid}</p>
      <p>HM Path: {hmPath.join("/")}</p>
      <p>Data: {JSON.stringify(data)}</p>
    </div>
  );
}
