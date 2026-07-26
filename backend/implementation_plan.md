# Implementation Plan - Customer App Fixes

This plan addresses 7 critical issues in the customer application by updating the backend logic and `FirebaseModel` wrapper.

## Proposed Changes

### 1. Backend Core (tind-backend)

#### [MODIFY] [FirebaseModel.js](file:///c:/Users/Asus/Desktop/Tind%20firebase/tind-backend/backend/src/models/firebaseModel.js)
- Update `findOne` and `findAll` to handle the `id` field specifically using `admin.firestore.FieldPath.documentId()`.
- Ensure `destroy` correctly filters by ID.

#### [MODIFY] [cartController.js](file:///c:/Users/Asus/Desktop/Tind%20firebase/tind-backend/backend/src/controllers/cartController.js)
- Replace `include` in `getCart` and `addToCart` with manual fetches for `CartItem`, `Product`, and `Seller`.
- Fix the single-seller rule enforcement.

#### [MODIFY] [wishlistController.js](file:///c:/Users/Asus/Desktop/Tind%20firebase/tind-backend/backend/src/controllers/wishlistController.js)
- Replace `include` in `getWishlist` with manual fetches for `Product` details.

#### [MODIFY] [profileRoutes.js](file:///c:/Users/Asus/Desktop/Tind%20firebase/tind-backend/backend/src/routes/profileRoutes.js)
- Add `PATCH /` route for profile updates.
- Add `POST /verify-phone-otp` route.

#### [MODIFY] [profileController.js](file:///c:/Users/Asus/Desktop/Tind%20firebase/tind-backend/backend/src/controllers/profileController.js)
- Implement `updateProfile` and `verifyPhoneUpdateOtp`.

#### [MODIFY] [productController.js](file:///c:/Users/Asus/Desktop/Tind%20firebase/tind-backend/backend/src/controllers/productController.js)
- Fix search logic in `getNearbyProducts` to allow partial matches.

## Verification Plan
1. Test Address CRUD.
2. Test Cart persistence and single-seller rule.
3. Test Profile update with OTP.
4. Test Wishlist persistence.
5. Test Product search.
