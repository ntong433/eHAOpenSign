import { useEffect, useState, useRef } from "react";
import Parse from "parse";
import DocumentsReport from "../../reports/document/DocumentsReport";
import reportJson from "../../json/ReportJson";
import axios from "axios";
import Loader from "../../primitives/Loader";
import { useTranslation } from "react-i18next";
import { withSessionValidation } from "../../utils";
import {
  auditBelongsToSigner,
  findSignerForCurrentUser,
  pointerId
} from "../../utils/recipientIdentity";

function DashboardReport(props) {
  const { t } = useTranslation();
  const [List, setList] = useState([]);
  const [isLoader, setIsLoader] = useState(true);
  const [reportName, setReportName] = useState("");
  const [actions, setActions] = useState([]);
  const [heading, setHeading] = useState([]);
  const [isNextRecord, setIsNextRecord] = useState(false);
  const [isMoreDocs, setIsMoreDocs] = useState(true);
  const abortController = new AbortController();
  const docPerPage = 5;
  const [searchTerm, setSearchTerm] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [isSearchResult, setIsSearchResult] = useState(false);
  const debounceTimer = useRef(null);

  const getCurrentUserIdentity = () => {
    const current = Parse.User.current();
    const currentJson = current?.toJSON?.() || {};
    const fallbackEmail = localStorage.getItem("userEmail") || "";
    return {
      ...currentJson,
      objectId: currentJson.objectId || current?.id,
      email: currentJson.email || fallbackEmail,
      username: currentJson.username || fallbackEmail
    };
  };

  const filterNeedYourSignature = (records = []) => {
    const currentUserIdentity = getCurrentUserIdentity();
    return records.filter((obj) => {
      const currentSigner = findSignerForCurrentUser(
        obj?.Signers || [],
        currentUserIdentity
      );
      if (!currentSigner) return false;
      const signerId = pointerId(currentSigner);
      const hasSigned = obj?.AuditTrail?.some(
        (item) => auditBelongsToSigner(item, signerId) && item.Activity === "Signed"
      );
      return !hasSigned;
    });
  };

  useEffect(() => {
    setReportName("");
    setSearchTerm("");
    setMobileSearchOpen(false);
    getReportData(props.Record.reportId, 0, 20, "");

    // Function returned from useEffect is called on unmount
    return () => {
      setIsLoader(true);
      setList([]);
      setIsNextRecord(false);
      // Here it'll abort the fetch
      abortController.abort();
    };
    // eslint-disable-next-line
  }, [props.Record.reportId]);

  // below useEffect call when isNextRecord state is true and fetch next record
  useEffect(() => {
    if (isNextRecord) {
      getReportData(props.Record.reportId, List.length, 20, searchTerm);
    }
    // eslint-disable-next-line
  }, [isNextRecord]);

  const handleSearchChange = withSessionValidation(async (e) => {
    const term = e.target.value.toLowerCase();
    setSearchTerm(term);
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(async () => {
      try {
        const headers = {
          "Content-Type": "application/json",
          "X-Parse-Application-Id": localStorage.getItem("parseAppId"),
          sessiontoken: localStorage.getItem("accesstoken")
        };
        const url = `${localStorage.getItem("baseUrl")}functions/getReport`;
        const res = await axios.post(
          url,
          {
            reportId: props.Record.reportId,
            searchTerm: term,
            skip: 0,
            limit: docPerPage
          },
          { headers }
        );
        const rawData = res.data?.result || [];
        const data =
          props.Record.reportId === "5Go51Q7T8r"
            ? filterNeedYourSignature(rawData)
            : rawData;
        if (!data.error) {
          setList(data);
          setIsMoreDocs(data.length >= docPerPage);
          setIsNextRecord(false);
          setIsSearchResult(true);
        }
      } catch (err) {
        console.error("Search error:", err);
      }
    }, 300);
    setIsSearchResult(false);
  });

  const handleSearchPaste = (e) => {
    setTimeout(() => {
      handleSearchChange({ target: { value: e.target.value } });
    }, 0);
  };

  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  const getReportData = withSessionValidation(
    async (id, skipUserRecord = 0, limit = 20, term = searchTerm) => {
      setIsLoader(true);
      const json = reportJson(id);
      if (json) {
        setActions(json.actions);
        setReportName(json.reportName);
        setHeading(json.heading);
        const headers = {
          "Content-Type": "application/json",
          "X-Parse-Application-Id": localStorage.getItem("parseAppId"),
          sessiontoken: localStorage.getItem("accesstoken")
        };
        try {
          const skipRecord = id === "5Go51Q7T8r" ? 0 : skipUserRecord;
          const limitRecord = id === "5Go51Q7T8r" ? 200 : limit;
          const params = { reportId: id, skip: skipRecord, limit: limitRecord };
          if (term) {
            params.searchTerm = term;
          }
          const url = `${localStorage.getItem("baseUrl")}functions/getReport`;
          const res = await axios.post(url, params, {
            headers: headers,
            signal: abortController.signal // is used to cancel fetch query
          });
          if (id === "5Go51Q7T8r") {
            const arr = filterNeedYourSignature(res.data?.result || []);
            if (arr.length === docPerPage) {
              setIsMoreDocs(true);
            } else {
              setIsMoreDocs(false);
            }
            setList((prevRecord) =>
              prevRecord.length > 0 ? [...prevRecord, ...arr] : arr
            );
          } else {
            if (res.data.result.length >= docPerPage) {
              setIsMoreDocs(true);
            } else {
              setIsMoreDocs(false);
            }
            setIsNextRecord(false);
            if (!res.data.result.error) {
              setList((prevRecord) =>
                prevRecord.length > 0
                  ? [...prevRecord, ...res.data.result]
                  : res.data.result
              );
            }
          }
          setIsLoader(false);
        } catch (err) {
          const isCancel = axios.isCancel(err);
          if (!isCancel) {
            console.log("err ", err);
            setIsLoader(false);
          }
          setIsLoader(false);
        }
      } else {
        setIsLoader(false);
      }
    }
  );
  return (
    <>
      {isLoader ? (
        <div className="h-[250px] flex justify-center items-center">
          <Loader />
        </div>
      ) : (
        <>
          {reportName ? (
            <DocumentsReport
              ReportName={reportName}
              List={List}
              setList={setList}
              actions={actions}
              heading={heading}
              setIsNextRecord={setIsNextRecord}
              isMoreDocs={isMoreDocs}
              docPerPage={docPerPage}
              mobileSearchOpen={mobileSearchOpen}
              setMobileSearchOpen={setMobileSearchOpen}
              searchTerm={searchTerm}
              handleSearchChange={handleSearchChange}
              handleSearchPaste={handleSearchPaste}
              isSearchResult={isSearchResult}
            />
          ) : (
            <div className="flex items-center justify-center h-[100px] w-full bg-white rounded-box">
              <div className="text-center text-xl text-base-content">
                {t("report-not-found")}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

export default DashboardReport;
