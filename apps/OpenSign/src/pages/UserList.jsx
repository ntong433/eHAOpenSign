import React, { useEffect, useState } from "react";
import Parse from "parse";
import Alert from "../primitives/Alert";
import Loader from "../primitives/Loader";
import { useLocation } from "react-router";
import ModalUi from "../primitives/ModalUi";
import pad from "../assets/images/pad.svg";
import Tooltip from "../primitives/Tooltip";
import AddUser from "../components/AddUser";
import {
  useTranslation
} from "react-i18next";
import DeleteUserModal from "../primitives/DeleteUserModal";
import axios from "axios";
import PasswordResetModal from "../primitives/PasswordResetModal";
import { usersActions } from "../json/ReportJson";
import { withSessionValidation } from "../utils";

const heading = ["Profile Picture", "Display Name", "Email", "Department", "Job Title", "Company", "Phone", "Status", "Administrator", "Microsoft User", "Last Sync"];
const UserList = () => {
  const { t } = useTranslation();
  const [userList, setUserList] = useState([]);
  const [isLoader, setIsLoader] = useState(false);
  const [isModal, setIsModal] = useState({
    form: false,
    addseats: false,
    options: false
  });
  const location = useLocation();
  const isDashboard =
    location?.pathname === "/dashboard/35KBoSgoAK" ? true : false;
  const [currentPage, setCurrentPage] = useState(1);
  const [isAlert, setIsAlert] = useState({ type: "success", msg: "" });
  const [isActiveModal, setIsActiveModal] = useState({});
  const [isActLoader, setIsActLoader] = useState({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [formHeader, setFormHeader] = useState(t("add-user"));
  const [deleteUserRes, setDeleteUserRes] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [isActModal, setIsActModal] = useState({});
  const Extand_Class = localStorage.getItem("Extand_Class");
  const extClass = Extand_Class && JSON.parse(Extand_Class);
  const recordperPage = 10;
  const startIndex = (currentPage - 1) * recordperPage; // user per page

  const getPaginationRange = () => {
    const totalPageNumbers = 7; // Adjust this value to show more/less page numbers
    const pages = [];
    const totalPages = Math.ceil(userList.length / recordperPage);
    if (totalPages <= totalPageNumbers) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      const leftSiblingIndex = Math.max(currentPage - 1, 1);
      const rightSiblingIndex = Math.min(currentPage + 1, totalPages);

      const showLeftDots = leftSiblingIndex > 2;
      const showRightDots = rightSiblingIndex < totalPages - 2;

      const firstPageIndex = 1;
      const lastPageIndex = totalPages;

      if (!showLeftDots && showRightDots) {
        let leftItemCount = 3;
        let leftRange = Array.from({ length: leftItemCount }, (_, i) => i + 1);

        pages.push(...leftRange);
        pages.push("...");
        pages.push(totalPages);
      } else if (showLeftDots && !showRightDots) {
        let rightItemCount = 3;
        let rightRange = Array.from(
          { length: rightItemCount },
          (_, i) => totalPages - rightItemCount + i + 1
        );

        pages.push(firstPageIndex);
        pages.push("...");
        pages.push(...rightRange);
      } else if (showLeftDots && showRightDots) {
        let middleRange = Array.from(
          { length: 3 },
          (_, i) => leftSiblingIndex + i
        );

        pages.push(firstPageIndex);
        pages.push("...");
        pages.push(...middleRange);
        pages.push("...");
        pages.push(lastPageIndex);
      }
    }
    return pages;
  };
  const pageNumbers = getPaginationRange();
  // to slice out 10 objects from array for current page
  const indexOfLastDoc = currentPage * recordperPage;
  const indexOfFirstDoc = indexOfLastDoc - recordperPage;
  const currentList = userList?.slice(indexOfFirstDoc, indexOfLastDoc);
  useEffect(() => {
    fetchUserList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function fetchUserList() {
    try {
      setIsLoader(true);
      const extUser =
        localStorage.getItem("Extand_Class") &&
        JSON.parse(localStorage.getItem("Extand_Class"))?.[0];

      if (extUser) {
        const admin =
          extUser?.UserRole &&
          (extUser?.UserRole === "contracts_Admin" ||
            extUser?.UserRole === "contracts_OrgAdmin")
            ? true
            : false;
        setIsAdmin(admin);
      }
      
      const res = await Parse.Cloud.run("getDirectoryUsers", {
        limit: 1000,
        skip: 0
      });
      
      // Map directory users to the format expected by the frontend
      const mappedUsers = (res?.results || []).map(u => ({
          ...u,
          profilePic: u.photoUrl,
          displayName: u.displayName ?? "",
          email: u.email ?? "",
          department: u.department ?? "",
          jobTitle: u.jobTitle ?? "",
          company: u.company ?? "",
          phone: u.mobilePhone || (u.businessPhones && u.businessPhones[0]) || "",
          accountEnabled: u.accountEnabled,
          lastSynchronized: u.lastSynchronized || "Never",
          isMicrosoftUser: !!u.microsoftObjectId,
          IsDisabled: !u.accountEnabled
      }));
      
      setUserList(mappedUsers);
    } catch (err) {
      console.log("Err in fetch userlist", err);
      showAlert("danger", t("something-went-wrong-mssg"));
    } finally {
      setIsLoader(false);
    }
  }
  const handleModal = (modalName) => {
    setIsModal((obj) => ({ ...obj, [modalName]: !obj[modalName] }));
  };

  // Change page
  const paginateFront = () => {
    const lastValue = pageNumbers?.[pageNumbers?.length - 1];
    if (currentPage < lastValue) {
      setCurrentPage(currentPage + 1);
    }
  };

  const paginateBack = () => {
    if (startIndex > 0) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleUserData = (userData) => {
    if (userData) {
      setUserList((prev) => [userData, ...prev]);
    }
  };
  // `formatRow` is used to show data in poper manner like
  // if data is of array type then it will join array items with ","
  // if data is of object type then it Name values will be show in row
  // if no data available it will show hyphen "-"
  const formatRow = (row) => {
    if (Array.isArray(row)) {
      let updateArr = row.map((x) => x.Name);
      return updateArr.join(", ");
    } else if (typeof row === "object" && row !== null) {
      return row?.Name || "-";
    } else {
      return "-";
    }
  };
  const handleClose = () => setIsActiveModal({});

  const handleToggleSubmit = withSessionValidation(async (user) => {
    const index = userList.findIndex((obj) => obj.objectId === user.objectId);
    if (index !== -1) {
      setIsActiveModal({});
      setIsActLoader({ [user.objectId]: true });
      const newArray = [...userList];
      const IsDisabled = newArray[index]?.IsDisabled;
      newArray[index] = { ...newArray[index], IsDisabled: !IsDisabled };
      setUserList(newArray);
      try {
        const extUser = new Parse.Object("contracts_Users");
        extUser.id = user.objectId;
        extUser.set("IsDisabled", !IsDisabled);
        await extUser.save();
        showAlert(
          !IsDisabled === true ? "danger" : "success",
          !IsDisabled === true ? t("user-deactivated") : t("user-activated")
        );
      } catch (err) {
        showAlert("danger", t("something-went-wrong-mssg"));
        console.log("err in disable team", err);
      } finally {
        setIsActLoader({});
      }
    }
  });
  const handleToggleBtn = (user) => {
    setIsActiveModal({ [user.objectId]: true });
  };

  // `showAlert` handle show/hide alert
  const showAlert = (type, msg, timer = 1500) => {
    setIsAlert({ type, msg });
    setTimeout(() => setIsAlert({ type: "success", msg: "" }), timer);
  };

  const handleDeleteAccount = withSessionValidation(async (item) => {
    setDeleting(true);
    if (item?.UserId?.objectId) {
      const url = localStorage.getItem("baseUrl")?.replace(/\/app\/?$/, "/");
      const deleteUrl = `${url}deleteuser/${item.UserId.objectId}`;
      try {
        await axios.post(deleteUrl, null, {
          headers: { sessiontoken: localStorage.getItem("accesstoken") }
        });
        setUserList((prev) =>
          prev.filter((user) => user.objectId !== item.objectId)
        );
        showAlert("success", t("user-deleted-successfully"));
      } catch (err) {
        const message = err?.response?.data?.message || err?.message;
        setDeleteUserRes(message);
        showAlert("danger", message);
        console.log("Err in deleteuser acc", err);
      } finally {
        setDeleting(false);
      }
    } else {
      showAlert("danger", t("something-went-wrong-mssg"));
      setDeleteUserRes(t("something-went-wrong-mssg"));
      setDeleting(false);
    }
  });
  const handleCloseModal = () => {
    setIsActModal({});
    setDeleteUserRes("");
    setDeleting(false);
  };

  const handleActionBtn = withSessionValidation(async (act, item) => {
      setIsActModal({ [`${act.action}_${item.objectId}`]: true });
  });

  const handleAdminToggleClick = (item) => {
    // Show confirmation modal
    setIsActModal({ [`toggle_admin_${item.objectId}`]: true });
  };

  const submitAdminToggle = withSessionValidation(async (item) => {
    setIsActModal({});
    setIsActLoader({ [item.objectId]: true });
    try {
      const isCurrentlyAdmin = item.isAdministrator;
      const functionName = isCurrentlyAdmin ? 'removeAdminPrivileges' : 'promoteUserToAdmin';
      
      await Parse.Cloud.run(functionName, { userId: item.objectId });
      
      showAlert("success", isCurrentlyAdmin ? t("administrator-privileges-removed") : t("administrator-privileges-granted"));
      
      // Immediately update UI
      setUserList((prev) =>
        prev.map((u) => {
          if (u.objectId === item.objectId) {
            return { ...u, isAdministrator: !isCurrentlyAdmin };
          }
          return u;
        })
      );
    } catch (err) {
      console.log("Error toggling admin status:", err);
      showAlert("danger", err.message || t("something-went-wrong-mssg"));
    } finally {
      setIsActLoader({});
    }
  });

  const handleBtnVisibility = (act, item) => {
    if (act.restrictAdmin) {
      if (item?.UserRole === "contracts_Admin") {
        return false;
      } else {
        return item?.objectId !== extClass?.[0]?.objectId;
      }
    } else if (
      act.restrictBtn === true &&
      item?.objectId === extClass?.[0]?.objectId
    ) {
      return true;
    } else {
      return true;
    }
  };
  const handleActiveToggleVisibility = (item) => {
    if (item?.UserRole === "contracts_Admin") {
      return false;
    } else {
      return item?.objectId !== extClass?.[0]?.objectId;
    }
  };

  const submitPassword = withSessionValidation(async (userId, password) => {
    setIsLoader(true);
    setIsActModal({});
    try {
      const params = { userId, password };
      await Parse.Cloud.run("resetpassword", params);
      showAlert("success", t("password-has-been-reset"));
    } catch (err) {
      console.log("err while reset password", err);
      showAlert("danger", t(err.message), 2000);
    } finally {
      setIsLoader(false);
    }
  });
  // 8. Add an Error Boundary
  class UsersErrorBoundary extends React.Component {
    constructor(props) {
      super(props);
      this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
      return { hasError: true, error };
    }
    componentDidCatch(error, errorInfo) {
      console.error("Users Page Error:", error, errorInfo);
    }
    render() {
      if (this.state.hasError) {
        return (
          <div className="flex flex-col items-center justify-center h-screen bg-base-200">
            <div className="bg-red-100 border border-red-400 text-red-700 px-6 py-4 rounded-lg text-center shadow-lg">
              <h2 className="font-bold text-lg mb-2">Unable to display one or more user records.</h2>
              <p className="text-sm">See browser console for details.</p>
              <button 
                onClick={() => this.setState({ hasError: false })}
                className="mt-4 op-btn op-btn-primary op-btn-sm"
              >
                Try Again
              </button>
            </div>
          </div>
        );
      }
      return this.props.children;
    }
  }

  return (
    <UsersErrorBoundary>
      <div className="relative">
        {isLoader && (
          <div className="absolute w-full h-[300px] md:h-[400px] flex justify-center items-center z-30 rounded-box">
            <Loader />
          </div>
        )}
        {Object.keys(isActLoader)?.length > 0 && (
          <div className="absolute w-full h-full flex justify-center items-center bg-black/30 z-30 rounded-box">
            <Loader />
          </div>
        )}

        {
            !isLoader && (
              <>
                {isAdmin ? (
                  <div className="p-2 w-full bg-base-100 text-base-content op-card shadow-lg">
                    {isAlert.msg && (
                      <Alert type={isAlert.type}>{isAlert.msg}</Alert>
                    )}
                    <div className="flex flex-row items-center justify-between my-2 mx-3 text-[20px] md:text-[23px]">
                      <div className="font-light">
                        {t("report-name.Users")}{" "}
                        <span className="text-xs md:text-[13px] font-normal">
                          <Tooltip message={t("users-from-teams")} />
                        </span>
                      </div>
                      <div className="flex flex-row gap-2 items-center">
                        {/* Add user removed for Microsoft Entra ID integration */}
                      </div>
                    </div>
                    <div className="w-full overflow-x-auto">
                      <table className="op-table border-collapse w-full mb-[50px]">
                        <thead className="text-[14px]">
                          <tr className="border-y-[1px]">
                            {heading?.map((item, index) => (
                              <th key={index} className="px-4 py-2">
                                {t(`report-heading.${item}`)}
                              </th>
                            ))}
                            {usersActions?.length > 0 && (
                              <th className="p-2 text-transparent pointer-events-none">
                                {t("action")}
                              </th>
                            )}
                          </tr>
                        </thead>
                        {userList?.length > 0 && (
                          <tbody className="text-[12px]">
                            {currentList.map((item, index) => (
                              <tr className="border-y-[1px]" key={index}>
                                <td className="px-4 py-2">
                                  {item.profilePic ? (
                                    <img src={item.profilePic} alt="Profile" className="w-10 h-10 rounded-full object-cover" />
                                  ) : (
                                    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 font-bold">
                                      {item.displayName ? (item.displayName ?? "").charAt(0).toUpperCase() : "?"}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-2 font-semibold">
                                  {item.displayName || "—"}
                                </td>
                                <td className="px-4 py-2">
                                  {item.email || "—"}
                                </td>
                                <td className="px-4 py-2">
                                  {item.department || "—"}
                                </td>
                                <td className="px-4 py-2">
                                  {item.jobTitle || "—"}
                                </td>
                                <td className="px-4 py-2">
                                  {item.company || "—"}
                                </td>
                                <td className="px-4 py-2">
                                  {item.phone || "—"}
                                </td>
                                <td className="px-4 py-2">
                                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${item.accountEnabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {item.accountEnabled ? 'Active' : 'Disabled'}
                                  </span>
                                </td>
                                <td className="px-4 py-2">
                                  <div className="flex flex-col items-center gap-2">
                                    <div className={`px-2 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap ${item.isAdministrator ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                                      {item.isAdministrator ? '🟢 Administrator' : '⚪ User'}
                                    </div>
                                    {isAdmin && (
                                      <input 
                                        type="checkbox" 
                                        className="toggle toggle-primary toggle-sm" 
                                        checked={!!item.isAdministrator}
                                        onChange={() => handleAdminToggleClick(item)} 
                                      />
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-center">
                                  {item.isMicrosoftUser ? '✅' : '—'}
                                </td>
                                <td className="px-4 py-2 text-xs">
                                  {item.lastSynchronized !== "Never" ? new Date(item.lastSynchronized).toLocaleString() : "Never"}
                                </td>
                                {/* Actions column hidden for Entra ID managed users */}
                                {isAdmin && (
                                  <td className="px-3 py-2">
                                    <span className="text-gray-400 text-xs italic">Managed in Entra ID</span>
                                  </td>
                                )}
                                
                                <ModalUi 
                                  isOpen={isActModal["toggle_admin_" + item.objectId]} 
                                  title={item.isAdministrator ? "Remove Administrator Privileges" : "Promote to Administrator"} 
                                  handleClose={handleCloseModal}
                                >
                                  <div className="p-4 flex flex-col items-center">
                                    <p className="mb-6 text-center text-sm">
                                      {item.isAdministrator 
                                        ? `Remove Administrator privileges from ${item.displayName || item.email}?` 
                                        : `Make ${item.displayName || item.email} an Administrator?`}
                                    </p>
                                    <div className="flex flex-row gap-4">
                                      <button 
                                        className="op-btn op-btn-ghost" 
                                        onClick={handleCloseModal}
                                        disabled={isActLoader[item.objectId]}
                                      >
                                        Cancel
                                      </button>
                                      <button 
                                        className="op-btn op-btn-primary" 
                                        onClick={() => submitAdminToggle(item)}
                                        disabled={isActLoader[item.objectId]}
                                      >
                                        {isActLoader[item.objectId] ? <Loader /> : "Confirm"}
                                      </button>
                                    </div>
                                  </div>
                                </ModalUi>
                                <DeleteUserModal
                                  title={t("delete-account")}
                                  deleting={deleting}
                                  userEmail={item?.email || item?.Email || ""}
                                  isOpen={isActModal["delete_" + item.objectId]}
                                  onConfirm={() => handleDeleteAccount(item)}
                                  deleteRes={deleteUserRes}
                                  handleClose={handleCloseModal}
                                />
                                <PasswordResetModal
                                  isOpen={
                                    isActModal["resetpassword_" + item.objectId]
                                  }
                                  userId={item?.UserId?.objectId}
                                  onClose={handleCloseModal}
                                  onSubmit={submitPassword}
                                  showAlert={showAlert}
                                />
                              </tr>
                            ))}
                          </tbody>
                        )}
                      </table>
                    </div>
                    <div className="flex flex-row justify-between items-center text-xs font-medium">
                      <div className="op-join flex flex-wrap items-center p-2">
                        {userList.length > recordperPage && (
                          <button
                            onClick={() => paginateBack()}
                            className="op-join-item op-btn op-btn-sm"
                          >
                            {t("prev")}
                          </button>
                        )}
                        {pageNumbers.map((x, i) => (
                          <button
                            key={i}
                            onClick={() => setCurrentPage(x)}
                            disabled={x === "..."}
                            className={`${
                              x === currentPage ? "op-btn-active" : ""
                            } op-join-item op-btn op-btn-sm`}
                          >
                            {x}
                          </button>
                        ))}
                        {userList.length > recordperPage && (
                          <button
                            onClick={() => paginateFront()}
                            className="op-join-item op-btn op-btn-sm"
                          >
                            {t("next")}
                          </button>
                        )}
                      </div>
                    </div>
                    {userList?.length <= 0 && (
                      <div
                        className={`${
                          isDashboard ? "h-[317px]" : ""
                        } flex flex-col items-center justify-center w-ful bg-base-100 text-base-content rounded-xl py-4`}
                      >
                        <div className="w-[60px] h-[60px] overflow-hidden">
                          <img
                            className="w-full h-full object-contain"
                            src={pad}
                            alt="img"
                          />
                        </div>
                        <div className="text-sm font-semibold">
                          {t("no-data-available")}
                        </div>
                      </div>
                    )}
                    <ModalUi
                      isOpen={isModal.form}
                      title={formHeader}
                      handleClose={() => handleModal("form")}
                    >
                      <AddUser
                        showAlert={showAlert}
                        handleUserData={handleUserData}
                        closePopup={() => handleModal("form")}
                        setFormHeader={setFormHeader}
                      />
                    </ModalUi>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-screen w-full bg-base-100 text-base-content rounded-box">
                    <div className="text-center">
                      <h1 className="text-[60px] lg:text-[120px] font-semibold">
                        404
                      </h1>
                      <p className="text-[30px] lg:text-[50px]">
                        {t("page-not-found")}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )
        }
      </div>
    </UsersErrorBoundary>
  );
};

export default UserList;
