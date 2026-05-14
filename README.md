# سكربت النشر ومنح الصلاحيات
1. النشر = depoly.ts
التشغيل = 
npx hardhat run scripts/deploy.ts --network sepolia

2. تشغيل grant-proposer.ts

npx hardhat run scripts/grant-proposer.ts --network sepolia


3. تشغيل grant-executor.ts

npx hardhat run scripts/grant-executor.ts --network sepolia


4. تشغيل execute-roles.ts تنفييذ معا الانتظار


npx hardhat run scripts/execute-roles.ts --network sepolia


 اذا كان التنفيذ بدون  
 انتظار تشغيل execute-only.ts


 5. التحقق 
 npx hardhat run scripts/verify-roles.ts --network sepolia