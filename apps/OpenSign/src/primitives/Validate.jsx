import { useState, useEffect } from "react";
import Parse from "parse";
import { Navigate, Outlet, useLocation } from "react-router";
import Loader from "./Loader";
import { storePostLoginRedirect } from "../utils/postLoginRedirect";
import {
  readExternalSigningGrant,
  readSigningEntryAuthorization
} from "../utils/externalSigningGrant";

const Validate = () => {
  const location = useLocation();
  const [isUserValid, setIsUserValid] = useState(null);
  const [redirectTo, setRedirectTo] = useState("/");
  useEffect(() => {
    (async () => {
      const currentRoute = `${location.pathname}${location.search || ""}`;
      const queryParams = new URLSearchParams(location.search || "");
      const signingToken = queryParams.get("token") || "";
      const externalGrant = readExternalSigningGrant(signingToken);
      const signingEntryAuthorization =
        readSigningEntryAuthorization(signingToken);
      if (signingToken && !externalGrant?.grantToken && !signingEntryAuthorization) {
        setRedirectTo(`/login/${encodeURIComponent(signingToken)}`);
        setIsUserValid(false);
        return;
      }
      if (!localStorage.getItem("accesstoken")) {
        if (externalGrant?.grantToken) {
          setIsUserValid(true);
          return;
        }
        setRedirectTo("/");
        storePostLoginRedirect(currentRoute);
        setIsUserValid(false);
        return;
      }
      if (localStorage.getItem("accesstoken")) {
        try {
          const userDetails = JSON.parse(
            localStorage.getItem(
              `Parse/${localStorage.getItem("parseAppId")}/currentUser`
            )
          );
          // Use the session token to validate the user
          const userQuery = new Parse.Query(Parse.User);
          const user = await userQuery.get(userDetails?.objectId, {
            sessionToken: localStorage.getItem("accesstoken")
          });
          if (user) {
            setIsUserValid(true);
          } else {
            setRedirectTo("/");
            setIsUserValid(false);
          }
        } catch (error) {
          // Session token is invalid or there was an error
          setRedirectTo("/");
          setIsUserValid(false);
        }
      }
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  if (isUserValid === null) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-base-100">
        <Loader />
      </div>
    );
  }

  return isUserValid ? (
    <Outlet />
  ) : (
    <Navigate
      to={redirectTo}
      replace
      state={{ from: `${location.pathname}${location.search || ""}` }}
    />
  );
};

export default Validate;
