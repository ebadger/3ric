#include <iostream> 
#include <windows.h> 
#include <MddBootstrap.h>

int main(int, char**)
{
	// Take a dependency on Windows App SDK Stable.
	const UINT32 majorMinorVersion{ 0x00010000 };
	PCWSTR versionTag{ L"" };
	const PACKAGE_VERSION minVersion{};

	const HRESULT hr{ MddBootstrapInitialize(majorMinorVersion, versionTag, minVersion) };

	// Check the return code. If there is a failure, display the result.
	if (FAILED(hr))
	{
		wprintf(L"Error 0x%X in MddBootstrapInitialize(0x%08X, %s, %hu.%hu.%hu.%hu)\n",
			hr, majorMinorVersion, versionTag, minVersion.Major, minVersion.Minor, minVersion.Build, minVersion.Revision);
		return hr;
	}

	std::cout << "Hello World!\n";

	// Release the DDLM and clean up.
	MddBootstrapShutdown();
	return 0;
}