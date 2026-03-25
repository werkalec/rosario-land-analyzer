@echo off
set GIT="C:\Program Files\Git\bin\git.exe"
%GIT% init
%GIT% config user.email werkalec@gmail.com
%GIT% config user.name werkalec
%GIT% add .
%GIT% commit -m "Initial commit: Rosario Land Analyzer"
echo DONE
