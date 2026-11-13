plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.bipo99.bipo"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.bipo99.bipo"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        // Android 10 (API 29) è la versione minima supportata.
        minSdk = 29
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // Chiave di firma di SVILUPPO, versionata apposta: così ogni build del cloud
    // è firmata con la stessa chiave e l'APK si aggiorna senza disinstallare.
    // Nella Fase 8 passeremo a una chiave privata custodita nei Secret di GitHub.
    signingConfigs {
        create("bipoDev") {
            storeFile = file("bipo-dev.keystore")
            storePassword = "bipo-dev"
            keyAlias = "bipo"
            keyPassword = "bipo-dev"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("bipoDev")
        }
        release {
            signingConfig = signingConfigs.getByName("bipoDev")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
