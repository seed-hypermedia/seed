import {HMBlockNode, hmId, HMIDTypeSchema, packHmId} from "@shm/shared";
import {useMemo} from "react";
import {useNavigate, useParams, useSearchParams} from "react-router-dom";
import {useEntity} from "../models";
import {CopyTextButton} from "./CopyTextButton";
import {ExternalOpenButton} from "./ExternalOpenButton";
import Tabs, {TabType} from "./Tabs";
import CapabilitiesTab from "./tabs/CapabilitiesTab";
import ChangesTab from "./tabs/ChangesTab";
import CitationsTab from "./tabs/CitationsTab";
import CommentsTab from "./tabs/CommentsTab";
import DocumentTab from "./tabs/DocumentTab";
import {Title} from "./Title";

export default function HM() {
  const {"*": path} = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const navigate = useNavigate();
  const id = hmId(type, uid, {path: hmPath});
  const {data, isLoading} = useEntity(id);
  const url = packHmId(id);

  // Get current tab from URL or default to "document"
  const currentTab = (searchParams.get("tab") as TabType) || "document";

  // Function to change tabs
  const handleTabChange = (tab: TabType) => {
    setSearchParams({tab});
  };

  const preparedData = useMemo(() => {
    if (!data) return null;
    const {
      metadata,
      account,
      authors,
      genesis,
      generationInfo,
      version,
      content,
      ...rest
    } = data;
    const cleaned = {...metadata, ...rest};
    if (account) {
      cleaned.account = `hm://${account}`;
    }
    if (authors) {
      cleaned.authors = authors.map((author: string) => `hm://${author}`);
    }
    if (version) {
      cleaned.version = version
        .split(".")
        .map((changeCid: string) => `ipfs://${changeCid}`);
    }
    if (genesis) {
      cleaned.genesis = `ipfs://${genesis}`;
    }
    if (content) {
      cleaned.content = content.map(flattenBlockNode);
    }
    return flattenSingleItemArrays(cleaned);
  }, [data]);

  // Render tab content based on current tab
  const renderTabContent = () => {
    switch (currentTab) {
      case "document":
        return <DocumentTab data={preparedData} onNavigate={navigate} />;
      case "changes":
        return <ChangesTab />;
      case "comments":
        return <CommentsTab />;
      case "citations":
        return <CitationsTab />;
      case "capabilities":
        return <CapabilitiesTab data={preparedData} />;
      default:
        return null;
    }
  };

  return (
    <div className="container p-4 mx-auto">
      <Title
        className="mb-4"
        buttons={
          <>
            <CopyTextButton text={url} />
            <ExternalOpenButton url={url} />
          </>
        }
      >
        {url}
      </Title>

      <Tabs currentTab={currentTab} onTabChange={handleTabChange} />

      <div className="tab-content">{renderTabContent()}</div>
    </div>
  );
}

function flattenBlockNode(node: HMBlockNode) {
  console.log("flattening", node);
  // return node;
  const {block, children} = node;
  const out = {...block};
  if (children && Array.isArray(children)) {
    // @ts-ignore - Adding children property to the block
    out.children = children.map(flattenBlockNode);
  }
  return out;
}

function flattenSingleItemArrays(obj: any): any {
  for (const key in obj) {
    if (Array.isArray(obj[key])) {
      if (obj[key].length === 1) {
        obj[key] = obj[key][0];
      } else {
        obj[key] = obj[key].map(flattenSingleItemArrays);
      }
    } else if (typeof obj[key] === "object" && obj[key] !== null) {
      obj[key] = flattenSingleItemArrays(obj[key]);
    }
  }
  return obj;
}
